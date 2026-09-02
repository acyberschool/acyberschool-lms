"""Queued PowerPoint to PDF previews for protected Media Library files.

Conversion is deliberately worker-only. Learner requests never invoke
LibreOffice. Instructor uploads enqueue a media UUID; a separate worker drains
Redis, converts the protected source once, and stores a protected PDF preview
beside the original media object.
"""

import asyncio
import copy
import logging
import os
import shutil
import tempfile
from pathlib import Path

from sqlmodel import select

from src.core.events.database import _async_session_factory
from src.core.redis import get_redis_client
from src.db.media.media import Media, MediaTypeEnum
from src.db.organizations import Organization
from src.services.courses.transfer.storage_utils import (
    file_exists,
    get_s3_bucket_name,
    get_storage_client,
    is_s3_enabled,
)

logger = logging.getLogger(__name__)

REDIS_QUEUE_KEY = "learnhouse:office-preview:queue"
SUPPORTED_FORMATS = frozenset({"ppt", "pptx"})
JOB_TIMEOUT_SECONDS = 10 * 60


def office_preview_enabled() -> bool:
    return os.environ.get("LEARNHOUSE_OFFICE_PREVIEW_ENABLED", "true").strip().lower() == "true"


def enqueue_office_preview(media_uuid: str) -> bool:
    """Queue one presentation preview job. Never performs conversion inline."""
    if not office_preview_enabled():
        return False
    client = get_redis_client()
    if not client:
        logger.warning("Office preview enabled but Redis is unavailable; cannot queue %s", media_uuid)
        return False
    try:
        client.rpush(REDIS_QUEUE_KEY, media_uuid)
        return True
    except Exception as exc:
        logger.warning("Could not queue Office preview for %s: %s", media_uuid, exc)
        return False


async def resolve_media_storage_key(media: Media, db_session) -> str:
    """Resolve the server-only relative key under content/."""
    if media.storage_key:
        return media.storage_key
    if not media.file_id:
        raise FileNotFoundError("Media source has no stored file")
    org = (
        await db_session.execute(select(Organization).where(Organization.id == media.org_id))
    ).scalars().first()
    if not org:
        raise FileNotFoundError("Media organisation not found")
    return f"orgs/{org.org_uuid}/media/{media.media_uuid}/{media.file_id}"


def preview_storage_key(source_storage_key: str) -> str:
    """Deterministic relative preview key under content/."""
    source = Path(source_storage_key)
    return str(source.with_name(f"{source.stem}.preview.pdf"))


async def get_preview_media(media: Media, db_session) -> Media | None:
    """Return a PDF-shaped copy of media when its converted preview exists."""
    fmt = (media.file_format or "").strip().lower().lstrip(".")
    if media.media_type != MediaTypeEnum.UPLOAD or fmt not in SUPPORTED_FORMATS:
        return None
    source_key = await resolve_media_storage_key(media, db_session)
    preview_key = preview_storage_key(source_key)
    if not file_exists(f"content/{preview_key}"):
        return None
    preview = copy.copy(media)
    preview.storage_key = preview_key
    preview.file_format = "pdf"
    preview.file_mime = "application/pdf"
    preview.file_id = f"{Path(source_key).stem}.preview.pdf"
    return preview


def _copy_source_to_local(source_key: str, destination: str) -> bool:
    if is_s3_enabled():
        client = get_storage_client()
        if not client:
            return False
        try:
            client.download_file(
                get_s3_bucket_name(), f"content/{source_key}", destination
            )
            return True
        except Exception as exc:
            logger.error("Office preview source download failed: %s", exc)
            return False

    source_path = Path("content") / source_key
    if not source_path.is_file():
        return False
    Path(destination).parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_path, destination)
    return True


def _store_preview(local_pdf: str, preview_key: str) -> bool:
    if is_s3_enabled():
        client = get_storage_client()
        if not client:
            return False
        try:
            client.upload_file(
                local_pdf, get_s3_bucket_name(), f"content/{preview_key}"
            )
            client.head_object(
                Bucket=get_s3_bucket_name(), Key=f"content/{preview_key}"
            )
            return True
        except Exception as exc:
            logger.error("Office preview upload failed: %s", exc)
            return False

    destination = Path("content") / preview_key
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(local_pdf, destination)
    return True


async def convert_media_preview(media_uuid: str) -> bool:
    """Convert one PPT/PPTX media file to PDF and store the preview."""
    async with _async_session_factory() as db_session:
        media = (
            await db_session.execute(select(Media).where(Media.media_uuid == media_uuid))
        ).scalars().first()
        if not media or media.media_type != MediaTypeEnum.UPLOAD:
            return False
        fmt = (media.file_format or "").strip().lower().lstrip(".")
        if fmt not in SUPPORTED_FORMATS:
            return False
        source_key = await resolve_media_storage_key(media, db_session)

    preview_key = preview_storage_key(source_key)
    if file_exists(f"content/{preview_key}"):
        return True

    with tempfile.TemporaryDirectory(prefix="lh-office-") as temp_dir:
        source_path = os.path.join(temp_dir, f"source.{fmt}")
        out_dir = os.path.join(temp_dir, "out")
        os.makedirs(out_dir, exist_ok=True)

        if not await asyncio.to_thread(_copy_source_to_local, source_key, source_path):
            return False

        try:
            process = await asyncio.create_subprocess_exec(
                "libreoffice",
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                out_dir,
                source_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(
                process.communicate(), timeout=JOB_TIMEOUT_SECONDS
            )
        except (FileNotFoundError, asyncio.TimeoutError):
            logger.exception("LibreOffice conversion could not run for %s", media_uuid)
            return False

        output_pdf = os.path.join(out_dir, "source.pdf")
        if process.returncode != 0 or not os.path.isfile(output_pdf):
            logger.error(
                "LibreOffice conversion failed for %s: %s",
                media_uuid,
                stderr.decode("utf-8", errors="replace")[:1000],
            )
            return False

        return await asyncio.to_thread(_store_preview, output_pdf, preview_key)


async def run_worker() -> None:
    """Drain the Office preview Redis queue forever in a dedicated process."""
    if not office_preview_enabled():
        logger.info("Office preview worker disabled")
        return

    client = get_redis_client()
    if not client:
        raise RuntimeError("Office preview worker requires Redis")

    logger.info("Office preview worker started")
    while True:
        try:
            item = await asyncio.to_thread(client.blpop, REDIS_QUEUE_KEY, 5)
            if not item:
                continue
            raw = item[1]
            media_uuid = raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)
            ok = await convert_media_preview(media_uuid)
            if not ok:
                logger.error("Office preview job failed for %s", media_uuid)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Office preview worker loop failed")
            await asyncio.sleep(2)


if __name__ == "__main__":
    asyncio.run(run_worker())
