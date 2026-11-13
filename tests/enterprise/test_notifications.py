import hashlib
import hmac
import json

import pytest
from sqlmodel import select

from nmb_marketplace_agent.enterprise import notifications
from nmb_marketplace_agent.enterprise.models import (
    Approval,
    Notification,
    NotificationRoute,
    now_iso,
)

OLD = "2000-01-01T00:00:00.000000Z"


def _approval(**kw) -> Approval:
    return Approval(
        id=kw.pop("id", "a1"), tenant_id="t1", run_id="run-1",
        title=kw.pop("title", "Pay 5,000 to Amina"), requester=kw.pop("requester", "maker"),
        due_at="2026-01-01T00:00:00.000000Z", allowed_roles=["approver"],
        payload={"context": {"internal_note": "do not send"}}, **kw,
    )


def _notification(**kw) -> Notification:
    return Notification(
        id=kw.pop("id", "n1"), tenant_id="t1", event=kw.pop("event", "approval.requested"),
        approval_id=kw.pop("approval_id", "a1"), channel=kw.pop("channel", "webhook"),
        target=kw.pop("target", "https://hooks.example/x"), subject="Approval needed",
        body="body", status=kw.pop("status", "pending"),
        next_attempt_at=kw.pop("next_attempt_at", OLD), **kw,
    )


# ── routing ──────────────────────────────────────────────────────────
async def test_routes_for_reads_db_and_env(db, monkeypatch):
    db.add(NotificationRoute(id="r1", tenant_id="t1", role="approver",
                             channel="webhook", target="https://hooks.example/x"))
    db.add(NotificationRoute(id="r2", tenant_id="t1", role="user:maker",
                             channel="email", target="maker@bank.co"))
    await db.commit()

    assert await notifications.routes_for(db, "t1", ["approver"]) == [
        ("webhook", "https://hooks.example/x")
    ]
    assert await notifications.routes_for(db, "t1", ["user:maker"]) == [
        ("email", "maker@bank.co")
    ]

    monkeypatch.setenv("NMB_NOTIFY_ROUTES",
                       json.dumps({"approver": ["email:ops@bank.co", "bad:ignored"]}))
    routes = await notifications.routes_for(db, "t1", ["approver"])
    assert ("webhook", "https://hooks.example/x") in routes
    assert ("email", "ops@bank.co") in routes
    assert all(channel in ("webhook", "email") for channel, _ in routes)


# ── outbox ───────────────────────────────────────────────────────────
async def test_notify_is_idempotent_and_omits_payload(db, monkeypatch):
    monkeypatch.setenv("NMB_NOTIFY_ROUTES",
                       json.dumps({"approver": ["webhook:https://hooks.example/x"]}))
    approval = _approval(title="Pay card 4111 1111 1111 1111 to Amina")
    db.add(approval)
    await db.commit()

    assert await notifications.notify(db, approval, "approval.requested", ["approver"]) == 1
    assert await notifications.notify(db, approval, "approval.requested", ["approver"]) == 0

    rows = (await db.execute(select(Notification))).scalars().all()
    assert len(rows) == 1
    assert "do not send" not in rows[0].body
    assert "4111 1111 1111 1111" not in rows[0].body


async def test_dispatch_sent_then_backoff_then_dead(db, monkeypatch):
    sent = _notification(id="n-sent")
    retry = _notification(id="n-retry", target="https://hooks.example/y",
                          next_attempt_at="2999-01-01T00:00:00.000000Z")
    db.add(sent)
    db.add(retry)
    await db.commit()

    async def ok(_n):
        return True, ""

    monkeypatch.setattr(notifications, "_deliver", ok)
    assert await notifications.dispatch_due() == {"sent": 1, "retrying": 0, "dead": 0}
    await db.refresh(sent)
    assert sent.status == "sent" and sent.sent_at

    retry.next_attempt_at = OLD
    db.add(retry)
    await db.commit()

    async def fail(_n):
        return False, "connection refused"

    monkeypatch.setattr(notifications, "_deliver", fail)
    assert await notifications.dispatch_due() == {"sent": 0, "retrying": 1, "dead": 0}
    await db.refresh(retry)
    assert retry.attempts == 1 and retry.last_error == "connection refused"
    assert retry.next_attempt_at > now_iso()

    retry.attempts = notifications.MAX_ATTEMPTS - 1
    retry.next_attempt_at = OLD
    db.add(retry)
    await db.commit()
    assert await notifications.dispatch_due() == {"sent": 0, "retrying": 0, "dead": 1}
    await db.refresh(retry)
    assert retry.status == "dead"


# ── channels ─────────────────────────────────────────────────────────
class _Response:
    status_code = 204


class _Client:
    captured: dict = {}

    def __init__(self, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def post(self, url, content=None, headers=None):
        _Client.captured = {"url": url, "content": content, "headers": headers}
        return _Response()


async def test_webhook_is_signed_and_egress_is_enforced(monkeypatch):
    n = _notification()
    monkeypatch.setattr(notifications.httpx, "AsyncClient", _Client)
    monkeypatch.setenv("NOTIFY_HMAC_KEY", "notify-secret")

    monkeypatch.delenv("EGRESS_ALLOWED_HOSTS", raising=False)
    ok, err = await notifications._webhook(n)
    assert not ok and "allow-list" in err

    monkeypatch.setenv("EGRESS_ALLOWED_HOSTS", "hooks.example")
    ok, err = await notifications._webhook(n)
    assert ok, err
    expected = "sha256=" + hmac.new(
        b"notify-secret", _Client.captured["content"], hashlib.sha256
    ).hexdigest()
    assert _Client.captured["headers"]["x-nmb-signature"] == expected
    assert _Client.captured["headers"]["x-nmb-event"] == "approval.requested"


async def test_email_reports_missing_smtp(monkeypatch):
    monkeypatch.delenv("NMB_SMTP_HOST", raising=False)
    ok, err = await notifications._email(_notification(channel="email", target="ops@bank.co"))
    assert not ok and "NMB_SMTP_HOST" in err
