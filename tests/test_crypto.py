import base64

import pytest

import nmb_marketplace_agent.crypto as crypto


@pytest.fixture(autouse=True)
def _fresh_ring(monkeypatch):
    for name in ("NMB_ENCRYPTION_KEY", "NMB_ENCRYPTION_KEY_FILE",
                 "NMB_ENCRYPTION_KEYS_OLD", "NMB_ENCRYPTION_REQUIRED"):
        monkeypatch.delenv(name, raising=False)
    crypto.reset_keyring()
    yield
    crypto.reset_keyring()


def _key() -> str:
    return base64.urlsafe_b64encode(b"k" * 32).decode().rstrip("=")


def test_roundtrip_and_unique_nonces(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key())
    a = crypto.encrypt("lost my card", aad="handoffs.reason")
    b = crypto.encrypt("lost my card", aad="handoffs.reason")
    assert a.startswith(crypto.PREFIX) and a != b
    assert crypto.decrypt(a, aad="handoffs.reason") == "lost my card"


def test_aad_binds_value_to_column(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key())
    sealed = crypto.encrypt("secret", aad="handoff_messages.text")
    with pytest.raises(crypto.DecryptionError):
        crypto.decrypt(sealed, aad="notifications.body")


def test_tampered_value_is_rejected(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key())
    sealed = crypto.encrypt("secret", aad="handoffs.reason")
    head, blob = sealed.rsplit(":", 1)
    tampered = head + ":" + blob[:-4] + ("AAAA" if blob[-4:] != "AAAA" else "BBBB")
    with pytest.raises(crypto.DecryptionError):
        crypto.decrypt(tampered, aad="handoffs.reason")


def test_legacy_plaintext_passes_through(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key())
    assert crypto.decrypt("row written before the key", aad="handoffs.reason") == "row written before the key"


def test_old_key_still_decrypts_after_rotation(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key())
    sealed = crypto.encrypt("secret", aad="handoffs.reason")
    crypto.reset_keyring()

    new_key = base64.urlsafe_b64encode(b"n" * 32).decode().rstrip("=")
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", new_key)
    monkeypatch.setenv("NMB_ENCRYPTION_KEYS_OLD", _key())
    crypto.reset_keyring()

    assert crypto.decrypt(sealed, aad="handoffs.reason") == "secret"
    assert crypto.encrypt("secret", aad="handoffs.reason").split(":")[2] == crypto.keyring().primary_id


def test_required_mode_fails_closed(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_REQUIRED", "true")
    with pytest.raises(crypto.EncryptionKeyMissing):
        crypto.preflight()
    with pytest.raises(crypto.EncryptionKeyMissing):
        crypto.encrypt("secret", aad="handoffs.reason")


def test_missing_key_cannot_read_ciphertext(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key())
    sealed = crypto.encrypt("secret", aad="handoffs.reason")
    monkeypatch.delenv("NMB_ENCRYPTION_KEY")
    crypto.reset_keyring()
    with pytest.raises(crypto.EncryptionKeyMissing):
        crypto.decrypt(sealed, aad="handoffs.reason")


def test_dev_mode_without_key_stores_plaintext(monkeypatch):
    assert crypto.encrypt("plain", aad="handoffs.reason") == "plain"
