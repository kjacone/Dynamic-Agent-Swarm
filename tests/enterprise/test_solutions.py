import tempfile
from pathlib import Path

import pytest
from sqlmodel import select

from nmb_marketplace_agent.config.models import AgentConfig, EvalCase, EvalDataset
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.guardrails import PolicyEngine
from nmb_marketplace_agent.enterprise.models import (
    Approval,
    ConnectorConfig,
    PolicySet,
    WorkflowDefinition,
)
from nmb_marketplace_agent.enterprise.rbac import Principal
from nmb_marketplace_agent.enterprise.runtime import load_policy
from nmb_marketplace_agent.enterprise.solutions import loader
from nmb_marketplace_agent.enterprise.workflows import (
    Runtime,
    WorkflowEngine,
    validate_spec,
)
from nmb_marketplace_agent.enterprise.workflows.spec import WorkflowSpec

ALL = ["banking-kyc", "insurance-claims", "telco-service-ops", "gov-document-workflows",
       "healthcare-admin", "ngo-procurement", "enterprise-automation", "education-admissions"]


def test_catalogue_covers_every_target_market():
    packs = {p["id"]: p for p in loader.list_packs()}
    assert set(ALL) <= set(packs)
    assert {packs[i]["priority"] for i in ("banking-kyc", "insurance-claims")} == {"first"}
    assert {p["industry"] for p in packs.values()} >= {"banking", "insurance", "telecom", "government", "healthcare", "ngo", "corporate", "education"}


@pytest.mark.parametrize("sid", ALL)
async def test_every_pack_installs_with_valid_workflows(db, sid):
    inst = await loader.install_solution(db, "acme", sid, "admin")
    assert inst.created["agents"] and inst.created["workflows"]
    for d in (await db.execute(select(WorkflowDefinition).where(WorkflowDefinition.tenant_id == "acme"))).scalars():
        assert validate_spec(WorkflowSpec.model_validate(d.spec)) == [], d.key
        assert "@" not in str(d.spec)  # agent keys were bound to real ids
    assert (await audit.verify_chain(db, "acme")).ok


async def test_install_is_idempotent_parameterised_and_tenant_scoped(db):
    a = await loader.install_solution(db, "bank-a", "banking-kyc", "admin", {"edd_threshold": 55, "model": "ollama:llama3.1:8b"})
    b = await loader.install_solution(db, "bank-b", "banking-kyc", "admin")
    again = await loader.install_solution(db, "bank-a", "banking-kyc", "admin")
    assert a.created["agents"] == again.created["agents"]  # same ids -> upgrade in place
    assert set(a.created["agents"].values()).isdisjoint(b.created["agents"].values())
    spec = (await db.execute(select(WorkflowDefinition).where(WorkflowDefinition.tenant_id == "bank-a")
                             .order_by(WorkflowDefinition.version.desc()))).scalars().first().spec
    route = next(s for s in spec["steps"] if s["id"] == "route")
    assert ">= 55" in route["if"]
    ag = await db.get(AgentConfig, a.created["agents"]["document-analyst"])
    assert ag.model == "ollama:llama3.1:8b" and ag.tenant_id == "bank-a"
    ps = await db.get(PolicySet, "bank-a:banking-kyc")
    assert ps.version == 2
    assert (await db.execute(select(ConnectorConfig).where(ConnectorConfig.tenant_id == "bank-a"))).scalars().all()
    ds = (await db.execute(select(EvalDataset).where(EvalDataset.tenant_id == "bank-a"))).scalars().all()
    assert ds and (await db.execute(select(EvalCase).where(EvalCase.dataset_id == ds[0].id))).scalars().all()
    with pytest.raises(loader.PackError):
        await loader.install_solution(db, "bank-a", "banking-kyc", "admin", {"nonsense": 1})
    with pytest.raises(loader.PackError):
        await loader.install_solution(db, "bank-a", "../etc/passwd", "admin")


async def test_license_gates_solutions(db, monkeypatch):
    from nmb_marketplace_agent.enterprise import licensing
    monkeypatch.setenv("LICENSE_ENFORCE", "true")
    monkeypatch.setattr(licensing, "_cached", licensing.License(modules={"solutions"}, solutions={"banking-kyc"}))
    await loader.install_solution(db, "t", "banking-kyc", "admin")
    with pytest.raises(loader.PackError, match="license"):
        await loader.install_solution(db, "t", "insurance-claims", "admin")
    monkeypatch.setattr(licensing, "_cached", None)


# ── end-to-end: the banking KYC pack running on the engine ───────────
def kyc_runtime(db, agents, score, sanctions_error=False):
    by_id = {v: k for k, v in agents.items()}
    log = []

    async def agent(aid, prompt, ctx):
        k = by_id[aid]
        log.append(k)
        return {"document-analyst": '{"full_name":"Jane","id_number":"12345678","anomalies":[]}',
                "risk-analyst": f'```json\n{{"score": {score}, "factors": [], "recommendation": "edd", "rationale": "test"}}\n```',
                "case-writer": "Case file."}[k]

    async def conn(name, op, params):
        log.append(f"{name}.{op}")
        if name == "sanctions" and sanctions_error:
            raise RuntimeError("screening service down")
        return {"hit": False} if name == "sanctions" else {"customer_id": "C-1"}

    async def nosleep(_):
        return None

    return agent, conn, nosleep, log


async def _kyc(db, score, country="KE", sanctions_error=False):
    inst = await loader.install_solution(db, "bank", "banking-kyc", "admin")
    agent, conn, nosleep, log = kyc_runtime(db, inst.created["agents"], score, sanctions_error)
    rt = Runtime(agent_runner=agent, connector_runner=conn, policy=PolicyEngine(await load_policy(db, "bank")), sleep=nosleep)
    eng = WorkflowEngine(db, rt, "bank")
    run = await eng.start("kyc_onboarding", {"customer_name": "Jane Wanjiru", "country": country,
                                             "documents_text": "Passport 12345678 Jane Wanjiru", "declared_income": 90000}, "ops-1")
    return eng, run, log


async def test_kyc_low_risk_is_straight_through(db):
    _, run, log = await _kyc(db, score=20)
    assert run.status == "completed" and run.state["ctx"]["_outcome"] == "onboarded"
    assert "core_banking.create_customer" in log and not (await db.execute(select(Approval))).scalars().all()


async def test_kyc_high_risk_needs_two_compliance_officers(db):
    eng, run, log = await _kyc(db, score=85)
    assert run.status == "waiting_approval" and "core_banking.create_customer" not in log
    ap = (await db.execute(select(Approval))).scalars().first()
    assert ap.required_approvals == 2 and ap.allowed_roles == ["compliance_officer"]
    P = lambda s: Principal(s, "bank", {"compliance_officer"})  # noqa: E731
    await eng.decide(ap.id, P("officer-1"), "approve")
    await eng.decide(ap.id, P("officer-2"), "approve", "docs verified")
    await db.refresh(run)
    assert run.status == "completed" and run.state["ctx"]["_outcome"] == "onboarded"
    assert log[-2:] == ["core_banking.create_customer", "case-writer"]
    trail = [e.action for e in await audit.query(db, "bank", limit=500)]
    assert "approval.requested" in trail and trail.count("approval.approve") == 2
    assert (await audit.verify_chain(db, "bank")).ok


async def test_kyc_high_risk_country_forces_edd_and_rejection_declines(db):
    eng, run, _ = await _kyc(db, score=5, country="IR")
    assert run.status == "waiting_approval"
    ap = (await db.execute(select(Approval))).scalars().first()
    await eng.decide(ap.id, Principal("officer-1", "bank", {"compliance_officer"}), "reject", "high-risk jurisdiction")
    await db.refresh(run)
    assert run.state["ctx"]["_outcome"] == "declined"


async def test_kyc_screening_outage_falls_back_to_human(db):
    eng, run, log = await _kyc(db, score=10, sanctions_error=True)
    assert run.status == "waiting_approval" and "risk-analyst" not in log  # nothing proceeds without screening
    ap = (await db.execute(select(Approval))).scalars().first()
    assert "screening service down" in ap.summary



async def test_install_creates_knowledge_collection(db, monkeypatch):
    from nmb_marketplace_agent.enterprise.solutions import loader

    monkeypatch.setattr(loader, "build_index", lambda *a, **k: 2)
    monkeypatch.setattr(loader, "DOCS_ROOT", Path(tempfile.mkdtemp()))

    inst = await loader.install_solution(db, "t1", "banking-kyc", "test")
    kb = inst.created.get("knowledge", [])
    assert len(kb) == 1
    entry = kb[0]
    assert entry["name"] == "kyc-policy"
    assert entry["docs"] == 2
    assert entry["status"] == "ready"
    # both declared attach_to keys should have resolved to real agents
    assert set(entry["attach_to"]) == {"risk-analyst", "case-writer"}
    assert len(entry["attached_to"]) == 2


async def test_install_registers_training_dataset(db, tmp_path, monkeypatch):
    from nmb_marketplace_agent.enterprise.solutions import loader
    from nmb_marketplace_agent.training import store as training_store

    def _root():
        for d in ("datasets", "queue", "runs"):
            (tmp_path / d).mkdir(parents=True, exist_ok=True)
        return tmp_path
    monkeypatch.setattr(training_store, "root", _root)
    monkeypatch.setattr(loader, "build_index", lambda *a, **k: 2)
    monkeypatch.setattr(loader, "DOCS_ROOT", tmp_path / "docs")

    inst = await loader.install_solution(db, "t1", "banking-kyc", "test")
    tr = inst.created.get("training", [])
    assert len(tr) == 1
    assert tr[0]["rows"] == 3
    # the file the training store wrote must exist and be readable
    assert (tmp_path / "datasets" / f"{tr[0]['name']}.json").exists()


def test_list_packs_returns_v2_shape():
    from nmb_marketplace_agent.enterprise.solutions import loader

    packs = loader.list_packs()
    kyc = next(p for p in packs if p["id"] == "banking-kyc")
    assert kyc["delivery"] == "workflow"
    assert kyc["assets"]["knowledge_docs"] == 2
    assert kyc["assets"]["training_rows"] == 3
    assert kyc["assets"]["samples"] == 3
    assert kyc["assets"]["models"] == 2
    assert len(kyc["samples"]) == 3
    assert {c["id"] for c in kyc["samples"]} == {"low-risk", "high-risk", "injection"}

def test_validate_supervisor_rejects_bad_max_cost():
    from nmb_marketplace_agent.enterprise.solutions.loader import (
        PackError,
        _validate_supervisor,
    )

    pack = {
        "agents": [{"key": "a", "tools": []}],
        "supervisor": {
            "key": "sup",
            "delegates": ["a"],
            "limits": {"max_cost_usd": "lots"},
        },
    }
    with pytest.raises(PackError, match="max_cost_usd"):
        _validate_supervisor(pack)


def test_validate_supervisor_rejects_negative_cost():
    from nmb_marketplace_agent.enterprise.solutions.loader import (
        PackError,
        _validate_supervisor,
    )

    pack = {
        "agents": [{"key": "a", "tools": []}],
        "supervisor": {
            "key": "sup",
            "delegates": ["a"],
            "limits": {"max_cost_usd": -1},
        },
    }
    with pytest.raises(PackError, match="max_cost_usd"):
        _validate_supervisor(pack)