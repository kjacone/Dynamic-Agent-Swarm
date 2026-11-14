import base64

import pytest
from langgraph.checkpoint.serde.encrypted import EncryptedSerializer
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

import nmb_marketplace_agent.checkpoint_store as cps
import nmb_marketplace_agent.crypto as crypto


class FakeSaver:
    def __init__(self, serde=None):
        self.serde = serde if serde is not None else JsonPlusSerializer()


@pytest.fixture(autouse=True)
def _fresh_ring(monkeypatch):
    for name in ("NMB_ENCRYPTION_KEY", "NMB_ENCRYPTION_KEY_FILE",
                 "NMB_ENCRYPTION_KEYS_OLD", "NMB_ENCRYPTION_REQUIRED"):
        monkeypatch.delenv(name, raising=False)
    crypto.reset_keyring()
    yield
    crypto.reset_keyring()


def _key(seed: bytes) -> str:
    return base64.urlsafe_b64encode(seed * 32).decode().rstrip("=")


def _serde() -> EncryptedSerializer:
    return EncryptedSerializer(cps.KeyRingCipher(), JsonPlusSerializer())


STATE = [{"role": "user", "content": "my card was stolen, ref 4111"}, {"role": "assistant", "content": "ok"}]


def test_serde_roundtrip_seals_blob(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key(b"k"))
    serde = _serde()
    type_, blob = serde.dumps_typed(STATE)
    assert type_ == f"msgpack+{cps.CIPHER_PREFIX}{crypto.keyring().primary_id}"
    assert blob.startswith(b"enc:v1:")
    assert b"card was stolen" not in blob
    assert serde.loads_typed((type_, blob)) == STATE


def test_legacy_plaintext_blob_still_loads(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key(b"k"))
    plain_type, plain_blob = JsonPlusSerializer().dumps_typed(STATE)
    assert _serde().loads_typed((plain_type, plain_blob)) == STATE


def test_tampered_cipher_name_is_rejected(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key(b"k"))
    serde = _serde()
    type_, blob = serde.dumps_typed(STATE)
    typ, _, _cipher = type_.partition("+")
    with pytest.raises(crypto.DecryptionError):
        serde.loads_typed((f"{typ}+{cps.CIPHER_PREFIX}deadbeef", blob))


def test_install_wraps_once(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key(b"k"))
    saver = FakeSaver()
    assert cps.install(saver) is True
    wrapped = saver.serde
    assert isinstance(wrapped, EncryptedSerializer)
    assert cps.install(saver) is True
    assert saver.serde is wrapped


def test_install_without_key_is_a_noop(monkeypatch):
    saver = FakeSaver()
    original = saver.serde
    assert cps.install(saver) is False
    assert saver.serde is original


def test_install_required_without_key_raises(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_REQUIRED", "true")
    with pytest.raises(crypto.EncryptionKeyMissing):
        cps.install(FakeSaver())


def test_rewrap_seals_legacy_row(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key(b"k"))
    type_, blob = JsonPlusSerializer().dumps_typed(STATE)
    new_type, new_blob = cps._rewrap_row(type_, blob)
    assert new_type.startswith("msgpack+")
    assert new_blob.startswith(b"enc:v1:")
    assert _serde().loads_typed((new_type, new_blob)) == STATE
    assert cps._rewrap_row(new_type, new_blob) is None  # already on the current key


def test_rewrap_moves_blob_to_rotated_key(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key(b"a"))
    old_type, old_blob = _serde().dumps_typed(STATE)

    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key(b"b"))
    monkeypatch.setenv("NMB_ENCRYPTION_KEYS_OLD", _key(b"a"))
    crypto.reset_keyring()
    new_type, new_blob = cps._rewrap_row(old_type, old_blob)
    assert new_type.endswith(crypto.keyring().primary_id)

    monkeypatch.delenv("NMB_ENCRYPTION_KEYS_OLD")
    crypto.reset_keyring()
    assert _serde().loads_typed((new_type, new_blob)) == STATE
    with pytest.raises(crypto.EncryptionKeyMissing):
        cps.KeyRingCipher().decrypt(old_type.split("+")[1], old_blob)


def test_rewrap_skips_empty_and_null_blobs(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key(b"k"))
    assert cps._rewrap_row("empty", None) is None
    assert cps._rewrap_row("empty", b"") is None


class _FakeCursor:
    def __init__(self, rows_by_table):
        self.rows_by_table = rows_by_table
        self._rows = []
        self.updates = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        if sql.startswith("SELECT"):
            self._rows = next(v for k, v in self.rows_by_table.items() if k in sql)
        else:
            self.updates.append((sql, params))

    def fetchall(self):
        return self._rows


class _FakeConn:
    def __init__(self, cursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self):
        return self._cursor


def test_rewrap_walks_both_blob_tables(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", _key(b"k"))
    type_, blob = JsonPlusSerializer().dumps_typed(STATE)
    cursor = _FakeCursor({
        "checkpoint_blobs": [
            ("thread-1", "", "messages", "001", type_, blob),
            ("thread-1", "", "other", "001", "empty", b""),
        ],
        "checkpoint_writes": [
            ("thread-1", "", "cp-1", "task-1", "path", 0, type_, blob),
        ],
    })
    monkeypatch.setattr(cps, "_connect", lambda dsn: _FakeConn(cursor))

    summary = cps.rewrap("postgresql://fake")

    assert summary["checkpoint_blobs"] == {"scanned": 2, "written": 1, "failed": 0}
    assert summary["checkpoint_writes"] == {"scanned": 1, "written": 1, "failed": 0}
    assert len(cursor.updates) == 2
    for sql, params in cursor.updates:
        assert sql.startswith("UPDATE")
        new_type, new_blob, *keys = params
        assert new_type.startswith("msgpack+")
        assert new_blob.startswith(b"enc:v1:")
        assert _serde().loads_typed((new_type, new_blob)) == STATE
        assert keys  # primary-key values preserved
