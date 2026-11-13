import hashlib
import zipfile
from pathlib import Path
from typing import Any, Iterator

import ijson


def file_sha256(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def _conversation_stream(path: Path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            candidates = [info for info in archive.infolist() if not info.is_dir() and info.filename.lower().endswith("conversations.json")]
            if not candidates:
                raise ValueError("ZIP does not contain conversations.json")
            chosen = max(candidates, key=lambda info: info.file_size)
            with archive.open(chosen, "r") as handle:
                yield from ijson.items(handle, "item")
        return
    if path.suffix.lower() == ".json":
        with path.open("rb") as handle:
            yield from ijson.items(handle, "item")
        return
    raise ValueError("Unsupported archive. Upload a ChatGPT ZIP export or conversations.json")
