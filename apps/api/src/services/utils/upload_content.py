import asyncio
import logging
from typing import Literal, Optional
import boto3
import botocore.config
from botocore.exceptions import BotoCoreError, ClientError
import os
from fastapi import HTTPException, UploadFile
from config.config import get_learnhouse_config
from src.security.file_validation import validate_upload
from src.security.malware_scan import scan_upload_bytes
from src.services.utils.video_processing import ensure_faststart

logger = logging.getLogger(__name__)


_CONTENT_ROOT = "content"


def _safe_content_path(*parts: str) -> str:
    """Build a path under the content root and confirm (via realpath +
    commonpath) that user-supplied parts can't escape it. Returns the
    canonicalized absolute path; raises HTTP 400 on any traversal attempt."""
    for part in parts:
        if part is None or "\x00" in part or ".." in str(part).replace("\\", "/").split("/"):
            raise HTTPException(status_code=400, detail="Invalid file path")
    base_real = os.path.realpath(_CONTENT_ROOT)
    full_real = os.path.realpath(os.path.join(_CONTENT_ROOT, *parts))
    try:
        contained = full_real == base_real or os.path.commonpath([base_real, full_real]) == base_real
    except ValueError:
        contained = False
    if not contained:
        raise HTTPException(status_code=400, detail="Invalid file path")
    return full_real


def ensure_directory_exists(directory: str):
    if not os.path.exists(directory):
        os.makedirs(directory)


async def upload_file(
    file: UploadFile,
    directory: str,
    type_of_dir: Literal["orgs", "users"],
    uuid: str,
    allowed_types: list[str],
    filename_prefix: str,
    max_size: Optional[int] = None,
) -> str:
    """
    Secure file upload with validation and malware scanning.

    The upload is validated and scanned in memory before any bytes are written
    to permanent filesystem or object storage. If ClamAV is unavailable the
    production default is fail closed, so an unverified file never enters the
    LMS.
    """
    from uuid import uuid4
    from src.security.file_validation import get_safe_filename

    content_type, content = validate_upload(file, allowed_types, max_size)
    await scan_upload_bytes(content, file.filename or "upload")

    filename = get_safe_filename(
        file.filename, f"{uuid4()}_{filename_prefix}", content_type=content_type
    )

    await upload_content(
        directory=directory,
        type_of_dir=type_of_dir,
        uuid=uuid,
        file_binary=content,
        file_and_format=filename,
        allowed_formats=None,
    )

    return filename


async def upload_content(
    directory: str,
    type_of_dir: Literal["orgs", "users"],
    uuid: str,
    file_binary: bytes,
    file_and_format: str,
    allowed_formats: Optional[list[str]] = None,
):
    learnhouse_config = get_learnhouse_config()

    file_format = file_and_format.split(".")[-1].strip().lower()
    content_delivery = learnhouse_config.hosting_config.content_delivery.type

    if allowed_formats:
        if file_format not in allowed_formats:
            raise HTTPException(
                status_code=400,
                detail=f"File format {file_format} not allowed",
            )

    safe_dir = _safe_content_path(type_of_dir, uuid, directory)
    ensure_directory_exists(safe_dir)
    safe_path = _safe_content_path(type_of_dir, uuid, directory, file_and_format)

    if content_delivery == "filesystem":
        with open(safe_path, "wb") as f:
            f.write(file_binary)
        await asyncio.to_thread(ensure_faststart, safe_path)

    elif content_delivery == "s3api":
        s3 = boto3.client(
            "s3",
            endpoint_url=learnhouse_config.hosting_config.content_delivery.s3api.endpoint_url,
            config=botocore.config.Config(connect_timeout=10, read_timeout=60, retries={"max_attempts": 2}),
        )

        bucket_name = learnhouse_config.hosting_config.content_delivery.s3api.bucket_name or "learnhouse-media"
        local_path = safe_path
        s3_key = f"content/{type_of_dir}/{uuid}/{directory}/{file_and_format}"

        with open(local_path, "wb") as f:
            f.write(file_binary)

        await asyncio.to_thread(ensure_faststart, local_path)

        try:
            await asyncio.to_thread(s3.upload_file, local_path, bucket_name, s3_key)
            await asyncio.to_thread(s3.head_object, Bucket=bucket_name, Key=s3_key)
            logger.debug("S3 upload successful: %s", s3_key)
        except (ClientError, BotoCoreError) as e:
            logger.error("S3 upload failed: %s", e)
            raise HTTPException(status_code=500, detail="File upload to storage failed")
        finally:
            try:
                os.remove(local_path)
            except OSError as cleanup_err:
                logger.error("Failed to clean up temp file %s: %s", local_path, cleanup_err)


async def read_content(
    directory: str,
    type_of_dir: Literal["orgs", "users"],
    uuid: str,
    file_and_format: str,
) -> bytes:
    """Read raw bytes for a stored content file (filesystem or S3/R2)."""
    if (
        not file_and_format
        or "/" in file_and_format
        or "\\" in file_and_format
        or ".." in file_and_format
        or "\x00" in file_and_format
    ):
        raise HTTPException(status_code=400, detail="Invalid file name")

    learnhouse_config = get_learnhouse_config()
    content_delivery = learnhouse_config.hosting_config.content_delivery.type

    if content_delivery == "s3api":
        s3 = boto3.client(
            "s3",
            endpoint_url=learnhouse_config.hosting_config.content_delivery.s3api.endpoint_url,
            config=botocore.config.Config(connect_timeout=10, read_timeout=60, retries={"max_attempts": 2}),
        )
        bucket_name = learnhouse_config.hosting_config.content_delivery.s3api.bucket_name or "learnhouse-media"
        s3_key = f"content/{type_of_dir}/{uuid}/{directory}/{file_and_format}"
        try:
            resp = await asyncio.to_thread(s3.get_object, Bucket=bucket_name, Key=s3_key)
            return await asyncio.to_thread(resp["Body"].read)
        except (ClientError, BotoCoreError) as e:
            logger.error("S3 read failed: %s", e)
            raise HTTPException(status_code=404, detail="File not found")

    safe_path = _safe_content_path(type_of_dir, uuid, directory, file_and_format)
    if not os.path.exists(safe_path):
        raise HTTPException(status_code=404, detail="File not found")
    return await asyncio.to_thread(_read_file_bytes, safe_path)


def _read_file_bytes(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()
