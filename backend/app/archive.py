import hashlib
import zipfile
from pathlib import Path
from typing import Any, Iterator

import ijson


def file_sha256(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    """Hash a large file without loading it into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _conversation_stream(path: Path) -> Iterator[dict[str, Any]]:
    """Stream ChatGPT conversation objects from ZIP or JSON."""
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            candidates = [
                item for item in archive.infolist()
                if not item.is_dir() and item.filename.lower().endswith("conversations.json")
            ]
            if not candidates:
                raise ValueError("ZIP does not contain conversations.json")
            chosen = max(candidates, key=lambda item: item.file_size)
            with archive.open(chosen, "r") as stream:
                yield from ijson.items(stream, "item")
        return

    if path.suffix.lower() == ".json":
        with path.open("rb") as stream:
            yield from ijson.items(stream, "item")
        return

    raise ValueError("Unsupported archive. Expected ChatGPT ZIP or conversations.json")


def _text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, dict):
        return ""
    parts = content.get("parts")
    if isinstance(parts, list):
        output: list[str] = []
        for part in parts:
            if isinstance(part, str):
                output.append(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                output.append(part["text"])
        return "\n".join(value.strip() for value in output if value.strip()).strip()
    text = content.get("text")
    return text.strip() if isinstance(text, str) else ""


def iter_conversations(path: Path) -> Iterator[dict[str, Any]]:
    """Yield one normalized conversation at a time, ordered by message timestamp."""
    for index, raw in enumerate(_conversation_stream(path)):
        if not isinstance(raw, dict):
            continue

        conversation_id = str(raw.get("id") or raw.get("conversation_id") or f"conversation-{index}")
        title = str(raw.get("title") or "Untitled conversation").strip()[:500]
        mapping = raw.get("mapping") or {}
        messages: list[dict[str, Any]] = []

        if isinstance(mapping, dict):
            for node_id, node in mapping.items():
                if not isinstance(node, dict):
                    continue
                message = node.get("message")
                if not isinstance(message, dict):
                    continue

                author = message.get("author") or {}
                role = author.get("role") if isinstance(author, dict) else None
                if role not in {"user", "assistant"}:
                    continue

                text = _text_from_content(message.get("content"))
                if not text:
                    continue

                message_id = str(message.get("id") or node_id)
                created = message.get("create_time") or node.get("create_time")
                messages.append({
                    "id": message_id,
                    "role": role,
                    "text": text,
                    "created_at": str(created) if created is not None else None,
                    "_sort": float(created or 0),
                })

        messages.sort(key=lambda item: (item["_sort"], item["id"]))
        for message in messages:
            message.pop("_sort", None)

        if messages:
            yield {"id": conversation_id, "title": title, "messages": messages}


def chunk_messages(
    messages: list[dict[str, Any]],
    max_chars: int = 14_000,
) -> Iterator[list[dict[str, Any]]]:
    """Build bounded context chunks while preserving source IDs and speaker roles.

    Long individual messages are split into segments. Chunks have no overlap, so
    the same transcript is not billed repeatedly just to create context overlap.
    """
    if max_chars < 512:
        raise ValueError("max_chars must be at least 512")

    chunk: list[dict[str, Any]] = []
    size = 0
    content_budget = max_chars - 160

    for message in messages:
        text = message.get("text", "")
        segments = [
            text[offset:offset + content_budget]
            for offset in range(0, len(text), content_budget)
        ] or [""]

        for part_index, segment in enumerate(segments):
            entry = {
                "id": str(message["id"]),
                "role": str(message["role"]),
                "text": segment,
                "created_at": message.get("created_at"),
                "part_index": part_index,
            }
            estimated_size = len(segment) + 160

            if chunk and size + estimated_size > max_chars:
                yield chunk
                chunk = []
                size = 0

            chunk.append(entry)
            size += estimated_size

    if chunk:
        yield chunk
