from app import db


def test_init_db_and_dashboard(monkeypatch, tmp_path):
    from app.config import Settings
    settings = Settings(data_dir=tmp_path)
    monkeypatch.setattr("app.db.get_settings", lambda: settings)
    db.init_db()
    assert db.dashboard_counts() == {
        "archives": 0, "messages": 0, "knowledge": 0, "active_jobs": 0, "failed_jobs": 0
    }
