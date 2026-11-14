from app import db


def test_init_db_and_dashboard(monkeypatch, tmp_path):
    from app.config import Settings
    settings = Settings(data_dir=tmp_path)
    monkeypatch.setattr("app.db.get_settings", lambda: settings)
    db.init_db()
    assert db.dashboard_counts() == {
        "archives": 0, "messages": 0, "knowledge": 0,
        "active_jobs": 0, "failed_jobs": 0
    }


def test_resume_checkpoint_and_backup_job(monkeypatch, tmp_path):
    from app.config import Settings
    settings = Settings(data_dir=tmp_path)
    monkeypatch.setattr("app.db.get_settings", lambda: settings)
    db.init_db()
    archive, created = db.create_archive("test.zip", str(tmp_path / "test.zip"), 10, "a" * 64)
    assert created
    job = db.claim_job()
    assert job["attempts"] == 1
    db.update_job(job["id"], cursor=7, processed_conversations=7, status="retry")
    retry = db.claim_job()
    assert retry["cursor"] == 7
    assert retry["attempts"] == 2
    backup_id = db.create_backup_job(archive["id"])
    assert backup_id


def test_sync_job_is_independent_and_deduplicated(monkeypatch, tmp_path):
    from app.config import Settings
    settings = Settings(data_dir=tmp_path)
    monkeypatch.setattr("app.db.get_settings", lambda: settings)
    db.init_db()
    archive, created = db.create_archive(
        "test.zip", str(tmp_path / "test.zip"), 10, "d" * 64
    )
    assert created

    first = db.create_sync_job(archive["id"])
    second = db.create_sync_job(archive["id"])
    assert first == second

    job = db.claim_job()
    assert job["id"] == first
    assert job["mode"] == "sync_only"
    db.update_job(first, status="retry", error="receiver unavailable")

    retry = db.create_sync_job(archive["id"])
    assert retry == first
    assert db.claim_job()["id"] == first

    db.update_job(first, status="complete")
    later = db.create_sync_job(archive["id"])
    assert later != first


def test_stream_knowledge_export_and_source_provenance(monkeypatch, tmp_path):
    from app.config import Settings

    settings = Settings(data_dir=tmp_path)
    monkeypatch.setattr("app.db.get_settings", lambda: settings)
    db.init_db()
    archive, created = db.create_archive(
        "history.zip", str(tmp_path / "history.zip"), 123, "b" * 64
    )
    assert created

    conversation = {
        "id": "conversation-1",
        "title": "Source conversation",
        "messages": [{
            "id": "message-1",
            "role": "user",
            "text": "The original source statement",
            "created_at": "2026-11-13T00:00:00Z",
        }],
    }
    db.save_messages(archive["id"], conversation)
    db.save_knowledge(archive["id"], conversation["id"], {
        "id": "knowledge-1",
        "kind": "decision",
        "title": "A durable decision",
        "summary": "Summary",
        "content": "Full knowledge item",
        "tags": ["project"],
        "entities": ["MoonWitness"],
        "source_message_ids": ["message-1"],
        "confidence": 0.9,
    })

    records = list(db.iter_knowledge_records(archive_id=archive["id"], batch_size=1))
    assert len(records) == 1
    assert records[0]["tags"] == ["project"]
    assert records[0]["source_message_ids"] == ["message-1"]

    provenance = db.get_knowledge_sources("knowledge-1")
    assert provenance is not None
    assert provenance["messages"][0]["content"] == "The original source statement"
