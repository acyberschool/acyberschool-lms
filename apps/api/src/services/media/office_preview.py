"""Protected PowerPoint previews for Library media.

PowerPoint files remain private in LearnHouse storage. A one-time background
conversion writes a PDF sibling next to the original file. Learners read that
PDF through the same authenticated Media access check as the original.

The expensive LibreOffice work happens when content is authored or when a
missing preview is first requested, never on every learner page load.
"""

import asyncio
import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, Request
from fastapi.responses import Response
from sqlmodel import select

from src.core.events.database import _async_session_factory
from src.db.media.media import Media, MediaTypeEnum
from src.services.courses.transfer.storage_utils import (
    get_content_delivery_type,
    get_s3_bucket_name,
    get_storage_client,
)
from src.services.media.media_serve import (
    _headers,
    _resolve_storage_key,
    _serve_fs,
    _serve_s3,
)

logger = logging.getLogger(__name__)

PRESENTATION_FORMATS = frozenset({"ppt", "pptx"})
_PREVIEW_SUFFIX = ".preview.pdf"
_inflight: set[str] = set()
_preview_semaphore: Optional[asyncio.Semaphore] = None


def _semaphore() -> asyncio.Semaphore:
    global _preview_semaphore
    if _preview_semaphore is None:
        try:
            concurrency = max(1, int(os.environ.get("LEARNHOUSE_OFFICE_PREVIEW_CONCURRENCY", "1")))
        except (TypeError, ValueError):
            concurrency = 1
        _preview_semaphore = asyncio.Semaphore(concurrency)
    return _preview_semaphore


def is_presentation(media: Media) -> bool:
    return (
        media.media_type == MediaTypeEnum.UPLOAD
        and (media.file_format or "").lower().lstrip(".") in PRESENTATION_FORMATS
    )


async def _preview_key(media: Media, db_session) -> str:
    original_key = await _resolve_storage_key(db_session, media)
    return f"{original_key}{_PREVIEW_SUFFIX}"


def _s3_preview_exists(rel_key: str) -> bool:
    client = get_storage_client()
    if not client:
        return False
    try:
        client.head_object(Bucket=get_s3_bucket_name(), Key=f"content/{rel_key}")
        return True
    except Exception:
        return False


async def preview_ready(media: Media, db_session) -> bool:
    if not is_presentation(media):
        return False
    rel_key = await _preview_key(media, db_session)
    if get_content_delivery_type() == "s3api":
        return await asyncio.to_thread(_s3_preview_exists, rel_key)
    return await asyncio.to_thread((Path("content") / rel_key).is_file)


def schedule_office_preview(media_uuid: str) -> None:
    """Schedule at most one conversion for this media on the current process."""
    if not media_uuid or media_uuid in _inflight:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    _inflight.add(media_uuid)
    task = loop.create_task(generate_office_preview(media_uuid))

    def _done(_task: asyncio.Task) -> None:
        _inflight.discard(media_uuid)
        try:
            _task.result()
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("PowerPoint preview job failed for %s", media_uuid)

    task.add_done_callback(_done)


def _fetch_original(rel_key: str, local_path: str) -> bool:
    if get_content_delivery_type() == "s3api":
        client = get_storage_client()
        if not client:
            return False
        try:
            client.download_file(
                get_s3_bucket_name(), f"content/{rel_key}", local_path
            )
            return True
        except Exception:
            logger.exception("Could not download presentation %s", rel_key)
            return False

    source = Path("content") / rel_key
    if not source.is_file():
        return False
    shutil.copyfile(source, local_path)
    return True


def _store_preview(local_pdf: str, rel_key: str) -> bool:
    if get_content_delivery_type() == "s3api":
        client = get_storage_client()
        if not client:
            return False
        try:
            client.upload_file(
                local_pdf,
                get_s3_bucket_name(),
                f"content/{rel_key}",
                ExtraArgs={"ContentType": "application/pdf"},
            )
            return True
        except Exception:
            logger.exception("Could not upload presentation preview %s", rel_key)
            return False

    destination = Path("content") / rel_key
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(local_pdf, destination)
    return True


async def _run_libreoffice(local_source: str, output_dir: str) -> Optional[str]:
    binary = shutil.which("libreoffice") or shutil.which("soffice")
    if not binary:
        logger.error("PowerPoint preview unavailable: LibreOffice is not installed")
        return None

    profile_dir = Path(output_dir) / "lo-profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    profile_uri = profile_dir.resolve().as_uri()

    process = await asyncio.create_subprocess_exec(
        binary,
        "--headless",
        "--nologo",
        "--nodefault",
        "--nofirststartwizard",
        f"-env:UserInstallation={profile_uri}",
        "--convert-to",
        "pdf",
        "--outdir",
        output_dir,
        local_source,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=180)
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        logger.error("PowerPoint preview conversion timed out")
        return None

    if process.returncode != 0:
        logger.error(
            "PowerPoint preview conversion failed: %s %s",
            stdout.decode(errors="ignore"),
            stderr.decode(errors="ignore"),
        )
        return None

    expected = Path(output_dir) / f"{Path(local_source).stem}.pdf"
    if expected.is_file():
        return str(expected)

    candidates = list(Path(output_dir).glob("*.pdf"))
    return str(candidates[0]) if candidates else None


async def generate_office_preview(media_uuid: str) -> bool:
    async with _semaphore():
        async with _async_session_factory() as db_session:
            media = (
                await db_session.execute(
                    select(Media).where(Media.media_uuid == media_uuid)
                )
            ).scalars().first()
            if not media or not is_presentation(media):
                return False
            if await preview_ready(media, db_session):
                return True

            original_key = await _resolve_storage_key(db_session, media)
            target_key = await _preview_key(media, db_session)
            suffix = f".{(media.file_format or 'pptx').lower().lstrip('.')}"

        with tempfile.TemporaryDirectory(prefix="lh-office-") as td:
            local_source = str(Path(td) / f"presentation{suffix}")
            if not await asyncio.to_thread(_fetch_original, original_key, local_source):
                return False

            local_pdf = await _run_libreoffice(local_source, td)
            if not local_pdf:
                return False

            return await asyncio.to_thread(_store_preview, local_pdf, target_key)


async def serve_office_preview(
    request: Request,
    media: Media,
    db_session,
    *,
    is_public: bool,
    head: bool = False,
) -> Response:
    if not is_presentation(media):
        raise HTTPException(status_code=404, detail="This media is not a presentation")

    rel_key = await _preview_key(media, db_session)
    filename = (media.name or "presentation").strip().replace("/", "-").replace("\\", "-")
    if not filename.lower().endswith(".pdf"):
        filename = f"{filename}.pdf"
    headers = _headers("application/pdf", is_public, filename, False)
    range_header = request.headers.get("range")

    if get_content_delivery_type() == "s3api":
        return _serve_s3(rel_key, "application/pdf", headers, range_header, head)
    return _serve_fs(rel_key, "application/pdf", headers, range_header, head)
