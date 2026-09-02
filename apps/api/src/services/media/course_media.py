"""Course-scoped access to Media Library files used by learning activities.

A learner who can read a course may load the exact Media Library item that an
instructor attached to a Resource activity without gaining access to unrelated
library files. Course, paid-access and activity-lock checks remain delegated to
the existing activity service before this helper is called.
"""

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import ActivityRead, ActivitySubTypeEnum
from src.db.media.media import Media


async def get_media_attached_to_activity(
    activity: ActivityRead,
    media_uuid: str,
    db_session: AsyncSession,
) -> Media:
    """Return only the media explicitly referenced by this accessible activity."""
    if activity.is_locked:
        raise HTTPException(status_code=403, detail="Activity is locked")

    content = activity.content or {}
    if content.get("paid_access") is False:
        raise HTTPException(status_code=403, detail="Paid access required")

    if (
        activity.activity_sub_type != ActivitySubTypeEnum.SUBTYPE_DYNAMIC_RESOURCE
        or content.get("resource_type") != "media"
        or content.get("resource_uuid") != media_uuid
    ):
        raise HTTPException(status_code=404, detail="Learning file not found")

    media = (
        await db_session.execute(select(Media).where(Media.media_uuid == media_uuid))
    ).scalars().first()

    # Same-org is mandatory even when UUIDs match. This prevents an activity
    # payload from ever becoming a cross-tenant reference if corrupted or
    # manually altered.
    if not media or media.org_id != activity.org_id:
        raise HTTPException(status_code=404, detail="Learning file not found")

    return media
