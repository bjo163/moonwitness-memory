from app.config import Settings
from app.db import create_archive, create_sync_job, init_db, save_knowledge
from app.moonwitness import sync_to_moonwitness


class FakeResponse:
    def raise_for_status(self):
        return None


class FakeClient:
    def __init__(self):
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def post(self, url, headers, json):
        self.calls.append((url, headers, json))
        return FakeResponse()


def test_sync_sends_versioned_authenticated_batches(monkeypatch, tmp_path):
    settings = Settings(
        data_dir=tmp_path,
        moonwitness_sync_url="http://moonwitness.test/api/memory/import",
        moonwitness_sync_token="test-secret",
        moonwitness_batch_size=1,
    )
    monkeypatch.setattr("app.db.get_settings", lambda: settings)
    monkeypatch.setattr("app.moonwitness.get_settings", lambda: settings)
    init_db()
    archive, created = create_archive(
        "history.zip", str(tmp_path / "history.zip"), 10, "e" * 64
    )
    assert created

    for record_id in ("record-a", "record-b"):
        save_knowledge(archive["id"], "conversation-1", {
            "id": record_id,
            "kind": "story",
            "title": record_id,
            "summary": "summary",
            "content": "content",
            "tags": [],
            "entities": [],
            "source_message_ids": [],
            "confidence": 0.9,
        })

    fake = FakeClient()
    monkeypatch.setattr("app.moonwitness.httpx.Client", lambda **_kwargs: fake)

    assert sync_to_moonwitness(archive["id"]) == 2
    assert len(fake.calls) == 2
    for url, headers, payload in fake.calls:
        assert url == settings.moonwitness_sync_url
        assert headers["Authorization"] == "Bearer test-secret"
        assert payload["source"] == "moonwitness-memory"
        assert payload["schema_version"] == 1
        assert len(payload["records"]) == 1


def test_sync_refuses_unauthenticated_delivery(monkeypatch, tmp_path):
    settings = Settings(
        data_dir=tmp_path,
        moonwitness_sync_url="http://moonwitness.test/api/memory/import",
        moonwitness_sync_token="",
    )
    monkeypatch.setattr("app.moonwitness.get_settings", lambda: settings)
    try:
        sync_to_moonwitness("archive-id")
    except RuntimeError as exc:
        assert "MOONWITNESS_SYNC_TOKEN is required" in str(exc)
    else:
        raise AssertionError("Expected unauthenticated sync to fail closed")
