import json
import zipfile
from app.archive import chunk_messages, iter_conversations


def test_parse_chatgpt_zip(tmp_path):
    payload = [{
        "id": "conv-1", "title": "Test conversation",
        "mapping": {
            "node-1": {"message": {"id": "msg-1", "author": {"role": "user"}, "create_time": 1, "content": {"parts": ["Hello"]}}},
            "node-2": {"message": {"id": "msg-2", "author": {"role": "assistant"}, "create_time": 2, "content": {"parts": ["Hi there"]}}},
        },
    }]
    archive_path = tmp_path / "chatgpt.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("conversations.json", json.dumps(payload))
    conversations = list(iter_conversations(archive_path))
    assert len(conversations) == 1
    assert conversations[0]["id"] == "conv-1"
    assert [message["role"] for message in conversations[0]["messages"]] == ["user", "assistant"]


def test_chunks_keep_message_references():
    messages = [{"id": "a", "role": "user", "text": "x" * 120}, {"id": "b", "role": "assistant", "text": "y" * 120}]
    chunks = list(chunk_messages(messages, max_chars=180))
    assert chunks
    assert all(message["id"] in {"a", "b"} for chunk in chunks for message in chunk)
