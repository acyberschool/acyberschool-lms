from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.db.courses.activities import ActivitySubTypeEnum
from src.services.media.course_media import get_media_attached_to_activity


class _Scalars:
    def __init__(self, value):
        self._value = value

    def first(self):
        return self._value


class _Result:
    def __init__(self, value):
        self._value = value

    def scalars(self):
        return _Scalars(self._value)


class _Session:
    def __init__(self, media):
        self.media = media
        self.calls = 0

    async def execute(self, _statement):
        self.calls += 1
        return _Result(self.media)


def _activity(**overrides):
    values = {
        "activity_sub_type": ActivitySubTypeEnum.SUBTYPE_DYNAMIC_RESOURCE,
        "content": {
            "resource_type": "media",
            "resource_uuid": "media_allowed",
        },
        "org_id": 7,
        "is_locked": False,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.mark.asyncio
async def test_attached_media_is_returned_for_accessible_activity():
    media = SimpleNamespace(media_uuid="media_allowed", org_id=7)
    session = _Session(media)

    result = await get_media_attached_to_activity(
        _activity(), "media_allowed", session
    )

    assert result is media
    assert session.calls == 1


@pytest.mark.asyncio
async def test_unrelated_media_uuid_is_not_exposed():
    session = _Session(SimpleNamespace(media_uuid="media_other", org_id=7))

    with pytest.raises(HTTPException) as exc:
        await get_media_attached_to_activity(_activity(), "media_other", session)

    assert exc.value.status_code == 404
    assert session.calls == 0


@pytest.mark.asyncio
async def test_cross_org_media_is_not_exposed():
    session = _Session(SimpleNamespace(media_uuid="media_allowed", org_id=99))

    with pytest.raises(HTTPException) as exc:
        await get_media_attached_to_activity(_activity(), "media_allowed", session)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_locked_activity_cannot_serve_media():
    session = _Session(SimpleNamespace(media_uuid="media_allowed", org_id=7))

    with pytest.raises(HTTPException) as exc:
        await get_media_attached_to_activity(
            _activity(is_locked=True), "media_allowed", session
        )

    assert exc.value.status_code == 403
    assert session.calls == 0


@pytest.mark.asyncio
async def test_paid_activity_without_access_cannot_serve_media():
    session = _Session(SimpleNamespace(media_uuid="media_allowed", org_id=7))
    activity = _activity(content={"paid_access": False})

    with pytest.raises(HTTPException) as exc:
        await get_media_attached_to_activity(activity, "media_allowed", session)

    assert exc.value.status_code == 403
    assert session.calls == 0
