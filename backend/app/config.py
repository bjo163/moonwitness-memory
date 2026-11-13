from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)
    data_dir: Path = Path("/data")
    max_upload_gb: int = 500
    ai_chunk_chars: int = 14000
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    enable_embeddings: bool = True
    embedding_model: str = "intfloat/multilingual-e5-small"
    s3_endpoint_url: str = ""
    s3_bucket: str = "mw-memory"
    s3_region: str = "us-east-1"
    s3_access_key: str = "local-memory-access"
    s3_secret_key: str = "replace-this-long-random-secret"
    moonwitness_sync_url: str = ""
    moonwitness_sync_token: str = ""
    moonwitness_batch_size: int = 50

    @property
    def db_path(self) -> Path:
        return self.data_dir / "db" / "memory.sqlite3"

    @property
    def inbox_dir(self) -> Path:
        return self.data_dir / "inbox"

    @property
    def export_dir(self) -> Path:
        return self.data_dir / "exports"

    @property
    def vector_dir(self) -> Path:
        return self.data_dir / "vectors"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_gb * 1024**3


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    for path in (settings.data_dir, settings.inbox_dir, settings.db_path.parent, settings.export_dir, settings.vector_dir):
        path.mkdir(parents=True, exist_ok=True)
    return settings
