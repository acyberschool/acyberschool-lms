from typing import List, Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from src.core.events.database import get_db_session
from src.db.media.media import MediaCreate, MediaRead, MediaTypeEnum, MediaUpdate
from src.security.auth import get_current_user
from src.services.users.users import PublicUser
from src.services.courses.activities.activities import get_activity
from src.services.media.course_media import get_media_attached_to_activity
from src.services.media.office_preview import enqueue_office_preview, get_preview_media
from src.services.media.media import (
    create_media,
    get_media,
    get_media_list,
    update_media,
    delete_media,
    authorize_media_file,
    authorize_share_token,
    create_media_share_link,
)
from src.services.media.media_serve import serve_media_file


router = APIRouter()


# --- Course activity file serving -------------------------------------------
#
# Learners should not need broad Media Library permissions to consume a file an
# instructor deliberately attached to their course. These endpoints first run
# the existing LearnHouse activity access checks, then verify that the activity
# references this exact media UUID. The rest of the library stays inaccessible.

@router.get(
    "/course-activity/{activity_uuid}/{media_uuid}/file",
    summary="Serve media attached to a course activity",
    description="Streams only the Media Library file explicitly referenced by an accessible course Resource activity. Supports Range requests and optional download disposition.",
)
async def api_serve_course_activity_media_file(
    request: Request,
    activity_uuid: str,
    media_uuid: str,
    download: bool = False,
    current_user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    activity = await get_activity(request, activity_uuid, current_user, db_session)
    media = await get_media_attached_to_activity(activity, media_uuid, db_session)
    return await serve_media_file(
        request, media, db_session, is_public=False, download=download
    )


@router.head(
    "/course-activity/{activity_uuid}/{media_uuid}/file",
    summary="Course activity media metadata",
)
async def api_head_course_activity_media_file(
    request: Request,
    activity_uuid: str,
    media_uuid: str,
    current_user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    activity = await get_activity(request, activity_uuid, current_user, db_session)
    media = await get_media_attached_to_activity(activity, media_uuid, db_session)
    return await serve_media_file(
        request, media, db_session, is_public=False, head=True
    )


@router.get(
    "/course-activity/{activity_uuid}/{media_uuid}/preview",
    summary="Serve a converted presentation preview",
    description="Serves the protected PDF preview of an attached PPT/PPTX when the background Office worker has finished conversion. This endpoint never performs conversion.",
)
async def api_serve_course_activity_media_preview(
    request: Request,
    activity_uuid: str,
    media_uuid: str,
    current_user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    activity = await get_activity(request, activity_uuid, current_user, db_session)
    media = await get_media_attached_to_activity(activity, media_uuid, db_session)
    preview_media = await get_preview_media(media, db_session)
    if not preview_media:
        raise HTTPException(status_code=404, detail="Presentation preview is still being prepared")
    return await serve_media_file(
        request, preview_media, db_session, is_public=False
    )


@router.head(
    "/course-activity/{activity_uuid}/{media_uuid}/preview",
    summary="Presentation preview status",
)
async def api_head_course_activity_media_preview(
    request: Request,
    activity_uuid: str,
    media_uuid: str,
    current_user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    activity = await get_activity(request, activity_uuid, current_user, db_session)
    media = await get_media_attached_to_activity(activity, media_uuid, db_session)
    preview_media = await get_preview_media(media, db_session)
    if not preview_media:
        raise HTTPException(status_code=404, detail="Presentation preview is still being prepared")
    return await serve_media_file(
        request, preview_media, db_session, is_public=False, head=True
    )


# --- General Media Library file serving -------------------------------------

@router.get(
    "/{media_uuid}/file",
    summary="Serve a media file",
    description="Streams the media file's bytes after enforcing access (folder-aware). The storage path is never exposed to the client. Supports Range requests. Pass `download=true` to force a save-as instead of inline rendering.",
)
async def api_serve_media_file(
    request: Request,
    media_uuid: str,
    download: bool = False,
    current_user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    media, is_public = await authorize_media_file(request, media_uuid, current_user, db_session)
    return await serve_media_file(
        request, media, db_session, is_public=is_public, download=download
    )


@router.head("/{media_uuid}/file", summary="Media file metadata")
async def api_head_media_file(
    request: Request,
    media_uuid: str,
    current_user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    media, is_public = await authorize_media_file(request, media_uuid, current_user, db_session)
    return await serve_media_file(request, media, db_session, is_public=is_public, head=True)


# --- Shareable copy link (random + unique every call) ------------------------

@router.post(
    "/{media_uuid}/share-link",
    summary="Create a media share link",
    description="Mints a fresh random, revocable token each call. The link is NOT an access bypass — recipients still need access.",
)
async def api_create_media_share_link(
    request: Request,
    media_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await create_media_share_link(request, media_uuid, current_user, db_session)


@router.get("/shared/{token}/file", summary="Serve a shared media file by token")
async def api_serve_shared_media(
    request: Request,
    token: str,
    download: bool = False,
    current_user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    media, is_public = await authorize_share_token(request, token, current_user, db_session)
    return await serve_media_file(
        request, media, db_session, is_public=is_public, download=download
    )


@router.head("/shared/{token}/file", summary="Shared media file metadata by token")
async def api_head_shared_media(
    request: Request,
    token: str,
    current_user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    media, is_public = await authorize_share_token(request, token, current_user, db_session)
    return await serve_media_file(request, media, db_session, is_public=is_public, head=True)


@router.post(
    "/",
    response_model=MediaRead,
    summary="Create media",
    description="Create a media asset. For UPLOAD, send a multipart file. For EMBED, send a url.",
)
async def api_create_media(
    request: Request,
    org_id: int = Form(...),
    name: str = Form(...),
    media_type: MediaTypeEnum = Form(MediaTypeEnum.UPLOAD),
    description: Optional[str] = Form(""),
    url: Optional[str] = Form(""),
    public: bool = Form(True),
    folder_uuid: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> MediaRead:
    media_object = MediaCreate(
        org_id=org_id,
        name=name,
        media_type=media_type,
        description=description or "",
        url=url or "",
        public=public,
        folder_uuid=folder_uuid,
    )
    created = await create_media(
        request, media_object, current_user, db_session, file
    )
    if (
        created.media_type == MediaTypeEnum.UPLOAD
        and (created.file_format or "").strip().lower().lstrip(".") in {"ppt", "pptx"}
    ):
        # Fire-and-forget queue only. Conversion runs in the separate Office
        # worker and never consumes API or learner request capacity.
        enqueue_office_preview(created.media_uuid)
    return created


@router.get(
    "/{media_uuid}",
    response_model=MediaRead,
    summary="Get media",
    description="Get a single media asset by its UUID.",
)
async def api_get_media(
    request: Request,
    media_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> MediaRead:
    return await get_media(request, media_uuid, current_user, db_session)


@router.get(
    "/org/{org_id}/page/{page}/limit/{limit}",
    response_model=List[MediaRead],
    summary="List media for org",
    description="List media assets for an organization, paginated.",
)
async def api_get_media_list(
    request: Request,
    page: int,
    limit: int,
    org_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> List[MediaRead]:
    return await get_media_list(request, org_id, current_user, db_session, page, limit)


@router.put(
    "/{media_uuid}",
    response_model=MediaRead,
    summary="Update media",
    description="Update a media asset's metadata.",
)
async def api_update_media(
    request: Request,
    media_object: MediaUpdate,
    media_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> MediaRead:
    return await update_media(request, media_object, media_uuid, current_user, db_session)


@router.delete(
    "/{media_uuid}",
    summary="Delete media",
    description="Delete a media asset and remove it from any folders.",
)
async def api_delete_media(
    request: Request,
    media_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await delete_media(request, media_uuid, current_user, db_session)
