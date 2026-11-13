import json
import zipfile

import pytest

from app.archive import chunk_messages, iter_conversations


def test_parse_chatgpt_zip(tmp_path):
    payload = [{
        "id": "conv-1",
        "title": "Test conversation",
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


def test_parse_plain_conversations_json(tmp_path):
    path = tmp_path / "conversations.json"
    path.write_text(json.dumps([{
        "id": "conv-2",
        "mapping": {
            "node": {"message": {"id": "msg", "author": {"role": "user"}, "content": {"parts": ["Direct JSON"]}}}
        },
    }]), encoding="utf-8")
    result = list(iter_conversations(path))
    assert result[0]["messages"][0]["text"] == "Direct JSON"


def test_chunks_preserve_message_ids_and_bound_context():
    messages = [
        {"id": "user-1", "role": "user", "text": "x" * 1600},
        {"id": "assistant-1", "role": "assistant", "text": "answer"},
    ]
    chunks = list(chunk_messages(messages, max_chars=512))
    assert len(chunks) > 1
    assert {item["id"] for chunk in chunks for item in chunk} == {"user-1", "assistant-1"}
    assert all(sum(len(item["text"]) + 160 for item in chunk) <= 512 for chunk in chunks)


def test_chunk_size_must_be_reasonable():
    with pytest.raises(ValueError):
        list(chunk_messages([], max_chars=100))
