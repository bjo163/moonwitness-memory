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
