import logging
from functools import lru_cache
from typing import Any

from .config import get_settings

log = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _load_embedding_model(model_name: str):
    from fastembed import TextEmbedding
    return TextEmbedding(model_name=model_name)


def index_knowledge(items: list[dict[str, Any]]) -> None:
    settings = get_settings()
    if not settings.enable_embeddings or not items:
        return
    try:
        import lancedb

        model = _load_embedding_model(settings.embedding_model)
        # The configured default is a native FastEmbed multilingual model; it
        # does not use the E5 query:/passage: instruction prefixes.
        texts = [
            " ".join(part for part in (item["title"], item.get("summary", ""), item.get("content", "")) if part)
            for item in items
        ]
        vectors = list(model.embed(texts))
        rows = [
            {
                "id": item["id"],
                "title": item["title"],
                "kind": item["kind"],
                "summary": item.get("summary", ""),
                "content": item.get("content", ""),
                "vector": vector.tolist(),
            }
            for item, vector in zip(items, vectors, strict=True)
        ]

        db = lancedb.connect(str(settings.vector_dir))
        if "knowledge" in db.table_names():
            table = db.open_table("knowledge")
            for row in rows:
                table.delete(f"id = '{row['id']}'")
            table.add(rows)
        else:
            db.create_table("knowledge", data=rows)
    except Exception:
        log.exception("Local embedding index failed; SQLite FTS remains available")


def search_vectors(query: str, limit: int = 30) -> list[str]:
    settings = get_settings()
    if not settings.enable_embeddings or not query.strip():
        return []
    try:
        import lancedb

        db = lancedb.connect(str(settings.vector_dir))
        if "knowledge" not in db.table_names():
            return []
        model = _load_embedding_model(settings.embedding_model)
        query_vector = next(model.query_embed([query]))
        rows = (
            db.open_table("knowledge")
            .search(query_vector.tolist())
            .limit(max(1, min(limit, 100)))
            .to_list()
        )
        return [str(row["id"]) for row in rows if row.get("id")]
    except Exception:
        log.exception("Local semantic search failed; SQLite FTS remains available")
        return []
