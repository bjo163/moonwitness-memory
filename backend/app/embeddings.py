import logging
from typing import Any
from .config import get_settings

log = logging.getLogger(__name__)


def index_knowledge(items: list[dict[str, Any]]) -> None:
    settings = get_settings()
    if not settings.enable_embeddings or not items:
        return
    try:
        import lancedb
        from fastembed import TextEmbedding
        model = TextEmbedding(model_name=settings.embedding_model)
        texts = [f"passage: {item['title']}\n{item.get('summary', '')}\n{item.get('content', '')}" for item in items]
        vectors = list(model.embed(texts))
        rows = [
            {"id": item["id"], "title": item["title"], "kind": item["kind"],
             "summary": item.get("summary", ""), "content": item.get("content", ""),
             "vector": vector.tolist()}
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
