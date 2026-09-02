from types import SimpleNamespace

import pytest

from src.db.media.media import MediaTypeEnum
from src.services.media import office_preview


class _Redis:
    def __init__(self):
        self.items = []

    def rpush(self, key, value):
        self.items.append((key, value))


def _media(**overrides):
    values = {
        "media_type": MediaTypeEnum.UPLOAD,
        "media_uuid": "media_presentation",
        "org_id": 7,
        "storage_key": "orgs/org_1/media/random/deck.pptx",
        "file_id": "deck.pptx",
        "file_format": "pptx",
        "file_mime": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "name": "Board deck",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_preview_storage_key_is_deterministic_and_private():
    assert office_preview.preview_storage_key(
        "orgs/org_1/media/random/deck.pptx"
    ) == "orgs/org_1/media/random/deck.preview.pdf"


def test_enqueue_only_pushes_job_to_redis(monkeypatch):
    redis = _Redis()
    monkeypatch.setenv("LEARNHOUSE_OFFICE_PREVIEW_ENABLED", "true")
    monkeypatch.setattr(office_preview, "get_redis_client", lambda: redis)

    assert office_preview.enqueue_office_preview("media_presentation") is True
    assert redis.items == [
        (office_preview.REDIS_QUEUE_KEY, "media_presentation")
    ]


def test_disabled_preview_does_not_queue(monkeypatch):
    redis = _Redis()
    monkeypatch.setenv("LEARNHOUSE_OFFICE_PREVIEW_ENABLED", "false")
    monkeypatch.setattr(office_preview, "get_redis_client", lambda: redis)

    assert office_preview.enqueue_office_preview("media_presentation") is False
    assert redis.items == []


@pytest.mark.asyncio
async def test_ready_preview_returns_pdf_shaped_copy(monkeypatch):
    media = _media()
    monkeypatch.setattr(office_preview, "file_exists", lambda _path: True)

    preview = await office_preview.get_preview_media(media, SimpleNamespace())

    assert preview is not None
    assert preview is not media
    assert preview.file_format == "pdf"
    assert preview.file_mime == "application/pdf"
    assert preview.storage_key.endswith("deck.preview.pdf")
    assert media.file_format == "pptx"


@pytest.mark.asyncio
async def test_non_presentation_has_no_office_preview(monkeypatch):
    media = _media(file_format="docx")
    monkeypatch.setattr(office_preview, "file_exists", lambda _path: True)

    assert await office_preview.get_preview_media(media, SimpleNamespace()) is None
