from pathlib import Path
import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config
from .config import get_settings


def upload_archive(path: Path, key: str) -> str:
    settings = get_settings()
    if not settings.s3_endpoint_url:
        raise RuntimeError("S3_ENDPOINT_URL is not configured")
    client = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, retries={"max_attempts": 5}),
    )
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
    except Exception:
        client.create_bucket(Bucket=settings.s3_bucket)
    transfer = TransferConfig(multipart_threshold=64 * 1024 * 1024, multipart_chunksize=64 * 1024 * 1024, max_concurrency=2, use_threads=True)
    client.upload_file(
        str(path), settings.s3_bucket, key, Config=transfer,
        ExtraArgs={"ContentType": "application/zip" if path.suffix.lower() == ".zip" else "application/json"},
    )
    return f"s3://{settings.s3_bucket}/{key}"
