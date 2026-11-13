import json

from app import db
from app.config import Settings
from app.moonwitness import export_corpus


def test_export_corpus_writes_valid_ndjson(monkeypatch, tmp_path):
    settings = Settings(data_dir=tmp_path)
    monkeypatch.setattr("app.db.get_settings", lambda: settings)
    monkeypatch.setattr("app.moonwitness.get_settings", lambda: settings)
    db.init_db()
    archive, created = db.create_archive("source.zip", str(tmp_path / "source.zip"), 1, "c" * 64)
    assert created
    db.save_knowledge(archive["id"], "conversation-1", {
        "id": "knowledge-export-1",
        "kind": "concept",
        "title": "Exported item",
        "summary": "A valid NDJSON record",
        "content": "Body",
        "tags": ["one"],
        "entities": [],
        "source_message_ids": [],
        "confidence": 0.8,
    })

    output = export_corpus()
    lines = output.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["id"] == "knowledge-export-1"
    assert not output.with_suffix(output.suffix + ".tmp").exists()
