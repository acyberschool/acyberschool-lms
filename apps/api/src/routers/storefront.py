"""Public Acyberschool course storefront.

A course opts into the storefront through ``Course.extra_metadata.storefront``.
That keeps storefront presentation and commerce configuration with the course
without adding a parallel course model or a database migration.
"""

from datetime import datetime
from typing import Any
from uuid import uuid4

import stripe
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from config.config import get_learnhouse_config
from src.core.events.database import get_db_session
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, PublicUser, SuperadminAPITokenUser
from src.security.auth import get_authenticated_user, get_current_user
from src.security.rbac import AccessAction, check_resource_access
from src.security.superadmin import is_user_superadmin
from src.security.features_utils.usage import check_limits_with_usage, increase_feature_usage


router = APIRouter()


class StorefrontSection(BaseModel):
    type: str = Field(default="text", max_length=40)
    heading: str | None = Field(default=None, max_length=180)
    body: str | None = Field(default=None, max_length=12000)
    image_url: str | None = Field(default=None, max_length=2048)


class StorefrontConfig(BaseModel):
    enabled: bool = False
    headline: str | None = Field(default=None, max_length=200)
    subheadline: str | None = Field(default=None, max_length=500)
    cta_label: str = Field(default="Enroll", min_length=1, max_length=50)
    price_minor: int = Field(default=0, ge=0, le=100_000_000)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    sections: list[StorefrontSection] = Field(default_factory=list, max_length=40)
    custom_html: str | None = Field(default=None, max_length=500_000)
    custom_html_enabled: bool = False

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        return value.upper()


class CheckoutResponse(BaseModel):
    checkout_url: str
    session_id: str


def _storefront(course: Course) -> StorefrontConfig:
    metadata = course.extra_metadata or {}
    raw = metadata.get("storefront") or {}
    try:
        return StorefrontConfig.model_validate(raw)
    except Exception:
        # Bad legacy metadata must not break the whole public catalogue.
        return StorefrontConfig(enabled=False)


def _clean_uuid(value: str) -> str:
    return value.removeprefix("course_")


async def _get_course(course_uuid: str, db_session: AsyncSession) -> Course:
    clean = _clean_uuid(course_uuid)
    course = (await db_session.execute(
        select(Course).where(
            (Course.course_uuid == course_uuid)
            | (Course.course_uuid == f"course_{clean}")
        )
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


async def _public_course_payload(course: Course, db_session: AsyncSession) -> dict[str, Any]:
    org = (await db_session.execute(
        select(Organization).where(Organization.id == course.org_id)
    )).scalars().first()
    sf = _storefront(course)
    return {
        "id": course.id,
        "course_uuid": course.course_uuid,
        "name": course.name,
        "description": course.description,
        "about": course.about,
        "learnings": course.learnings,
        "tags": course.tags,
        "thumbnail_type": course.thumbnail_type,
        "thumbnail_image": course.thumbnail_image,
        "thumbnail_video": course.thumbnail_video,
        "org_id": course.org_id,
        "org_uuid": org.org_uuid if org else None,
        "org_slug": org.slug if org else None,
        "org_name": org.name if org else None,
        "storefront": sf.model_dump(),
    }


def _require_human_user(current_user) -> PublicUser:
    if isinstance(current_user, (APITokenUser, SuperadminAPITokenUser)):
        raise HTTPException(
            status_code=403,
            detail="Course purchases and learner enrollment require a user session",
        )
    return current_user


@router.get("/courses")
async def list_public_courses(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=24, ge=1, le=100),
    db_session: AsyncSession = Depends(get_db_session),
):
    # Storefront is opt-in even for an otherwise public course. This prevents an
    # institution's public-in-tenant course from accidentally appearing in the
    # Acyberschool commercial catalogue.
    candidates = (await db_session.execute(
        select(Course)
        .where(Course.public.is_(True), Course.published.is_(True))
        .order_by(Course.id.desc())
    )).scalars().all()
    enabled = [course for course in candidates if _storefront(course).enabled]
    start = (page - 1) * limit
    items = enabled[start:start + limit]
    return {
        "items": [await _public_course_payload(course, db_session) for course in items],
        "total": len(enabled),
        "page": page,
        "limit": limit,
    }


@router.get("/courses/{course_uuid}")
async def get_public_course(
    course_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
):
    course = await _get_course(course_uuid, db_session)
    sf = _storefront(course)
    if not course.public or not course.published or not sf.enabled:
        raise HTTPException(status_code=404, detail="Course is not available in the public catalogue")
    return await _public_course_payload(course, db_session)


@router.put("/courses/{course_uuid}/landing")
async def update_course_landing(
    course_uuid: str,
    payload: StorefrontConfig,
    request: Request,
    current_user=Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    course = await _get_course(course_uuid, db_session)
    human = _require_human_user(current_user)

    if not await is_user_superadmin(human.id, db_session):
        await check_resource_access(
            request,
            db_session,
            human,
            course.course_uuid,
            AccessAction.WRITE,
        )

    metadata = dict(course.extra_metadata or {})
    metadata["storefront"] = payload.model_dump(mode="json")
    course.extra_metadata = metadata
    course.update_date = str(datetime.now())
    db_session.add(course)
    await db_session.commit()
    await db_session.refresh(course)
    return await _public_course_payload(course, db_session)


async def _ensure_membership(user_id: int, org_id: int, db_session: AsyncSession) -> None:
    membership = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == org_id,
        )
    )).scalars().first()
    if membership is not None:
        return

    await check_limits_with_usage("members", org_id, db_session)
    now = str(datetime.now())
    db_session.add(UserOrganization(
        user_id=user_id,
        org_id=org_id,
        role_id=4,
        creation_date=now,
        update_date=now,
    ))
    await db_session.commit()
    await increase_feature_usage("members", org_id, db_session)

    from src.routers.users import _invalidate_session_cache
    _invalidate_session_cache(user_id)


async def _ensure_enrollment(user_id: int, course: Course, db_session: AsyncSession) -> TrailRun:
    await _ensure_membership(user_id, course.org_id, db_session)

    existing = (await db_session.execute(
        select(TrailRun).where(
            TrailRun.user_id == user_id,
            TrailRun.course_id == course.id,
            TrailRun.org_id == course.org_id,
        )
    )).scalars().first()
    if existing:
        return existing

    trail = (await db_session.execute(
        select(Trail).where(Trail.user_id == user_id, Trail.org_id == course.org_id)
    )).scalars().first()
    now = str(datetime.now())
    if trail is None:
        trail = Trail(
            user_id=user_id,
            org_id=course.org_id,
            trail_uuid=f"trail_{uuid4()}",
            creation_date=now,
            update_date=now,
        )
        db_session.add(trail)
        await db_session.commit()
        await db_session.refresh(trail)

    run = TrailRun(
        trail_id=int(trail.id or 0),
        course_id=int(course.id or 0),
        org_id=course.org_id,
        user_id=user_id,
        creation_date=now,
        update_date=now,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)
    return run


@router.get("/courses/{course_uuid}/access")
async def course_access(
    course_uuid: str,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    course = await _get_course(course_uuid, db_session)
    sf = _storefront(course)
    user_id = getattr(current_user, "id", 0)
    enrolled = False
    if user_id:
        enrolled = (await db_session.execute(
            select(TrailRun.id).where(
                TrailRun.user_id == user_id,
                TrailRun.course_id == course.id,
                TrailRun.org_id == course.org_id,
            )
        )).scalar_one_or_none() is not None
    return {
        "authenticated": bool(user_id),
        "enrolled": enrolled,
        "paid": sf.price_minor > 0,
        "price_minor": sf.price_minor,
        "currency": sf.currency,
    }


@router.post("/courses/{course_uuid}/enroll")
async def enroll_free_course(
    course_uuid: str,
    current_user=Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    human = _require_human_user(current_user)
    course = await _get_course(course_uuid, db_session)
    sf = _storefront(course)
    if not course.public or not course.published or not sf.enabled:
        raise HTTPException(status_code=404, detail="Course is not available")
    if sf.price_minor > 0:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Payment is required for this course")
    await _ensure_enrollment(human.id, course, db_session)
    return {"enrolled": True, "course_uuid": course.course_uuid}


def _catalog_base_url() -> str:
    cfg = get_learnhouse_config()
    protocol = "https" if cfg.hosting_config.ssl else "http"
    return f"{protocol}://{cfg.hosting_config.frontend_domain}".rstrip("/")


@router.post("/courses/{course_uuid}/checkout", response_model=CheckoutResponse)
async def create_course_checkout(
    course_uuid: str,
    current_user=Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    human = _require_human_user(current_user)
    course = await _get_course(course_uuid, db_session)
    sf = _storefront(course)
    if not course.public or not course.published or not sf.enabled:
        raise HTTPException(status_code=404, detail="Course is not available")
    if sf.price_minor <= 0:
        await _ensure_enrollment(human.id, course, db_session)
        raise HTTPException(status_code=409, detail="This course is free and has already been enrolled")

    existing = (await db_session.execute(
        select(TrailRun.id).where(
            TrailRun.user_id == human.id,
            TrailRun.course_id == course.id,
            TrailRun.org_id == course.org_id,
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="You are already enrolled in this course")

    cfg = get_learnhouse_config()
    secret = cfg.payments_config.stripe.stripe_secret_key
    if not secret:
        raise HTTPException(status_code=503, detail="Course payments are not configured")
    stripe.api_key = secret

    clean_uuid = _clean_uuid(course.course_uuid)
    base = _catalog_base_url()
    session = stripe.checkout.Session.create(
        mode="payment",
        payment_method_types=["card"],
        customer_email=str(human.email),
        line_items=[{
            "price_data": {
                "currency": sf.currency.lower(),
                "unit_amount": sf.price_minor,
                "product_data": {
                    "name": course.name,
                    "description": (course.description or "")[:500],
                },
            },
            "quantity": 1,
        }],
        metadata={
            "purchase_type": "acyberschool_course",
            "course_uuid": course.course_uuid,
            "org_id": str(course.org_id),
            "user_id": str(human.id),
        },
        success_url=f"{base}/catalog/{clean_uuid}?payment=success&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{base}/catalog/{clean_uuid}?payment=cancelled",
    )
    if not session.url:
        raise HTTPException(status_code=502, detail="Payment checkout could not be created")
    return CheckoutResponse(checkout_url=session.url, session_id=session.id)


@router.post("/stripe/webhook")
async def stripe_course_webhook(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
):
    cfg = get_learnhouse_config()
    secret_key = cfg.payments_config.stripe.stripe_secret_key
    webhook_secret = cfg.payments_config.stripe.stripe_webhook_standard_secret
    if not secret_key or not webhook_secret:
        raise HTTPException(status_code=503, detail="Course payment webhook is not configured")

    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    stripe.api_key = secret_key
    try:
        event = stripe.Webhook.construct_event(payload, signature, webhook_secret)
    except (ValueError, stripe.error.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook")

    if event.get("type") == "checkout.session.completed":
        session = event.get("data", {}).get("object", {})
        metadata = session.get("metadata") or {}
        if (
            metadata.get("purchase_type") == "acyberschool_course"
            and session.get("payment_status") == "paid"
        ):
            try:
                user_id = int(metadata["user_id"])
                course = await _get_course(metadata["course_uuid"], db_session)
            except (KeyError, TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Invalid course purchase metadata")
            await _ensure_enrollment(user_id, course, db_session)

    return {"received": True}


@router.get("/courses/{course_uuid}/entry")
async def get_course_entry_point(
    course_uuid: str,
    current_user=Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    human = _require_human_user(current_user)
    course = await _get_course(course_uuid, db_session)
    org = (await db_session.execute(
        select(Organization).where(Organization.id == course.org_id)
    )).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    run = (await db_session.execute(
        select(TrailRun).where(
            TrailRun.user_id == human.id,
            TrailRun.course_id == course.id,
            TrailRun.org_id == course.org_id,
        )
    )).scalars().first()
    if not run:
        raise HTTPException(status_code=403, detail="Enroll in this course before entering the classroom")

    ordered_activity_ids = (await db_session.execute(
        select(ChapterActivity.activity_id)
        .join(CourseChapter, CourseChapter.chapter_id == ChapterActivity.chapter_id)
        .where(
            CourseChapter.course_id == course.id,
            ChapterActivity.course_id == course.id,
        )
        .order_by(CourseChapter.order.asc(), ChapterActivity.order.asc())
    )).scalars().all()

    completed_ids = set((await db_session.execute(
        select(TrailStep.activity_id).where(
            TrailStep.user_id == human.id,
            TrailStep.course_id == course.id,
            TrailStep.complete.is_(True),
        )
    )).scalars().all())

    next_activity_id = next(
        (activity_id for activity_id in ordered_activity_ids if activity_id not in completed_ids),
        None,
    )
    clean_course = _clean_uuid(course.course_uuid)
    if next_activity_id is None:
        return {
            "org_slug": org.slug,
            "course_uuid": clean_course,
            "activity_uuid": None,
            "completed": bool(ordered_activity_ids),
            "path": f"/course/{clean_course}",
        }

    # The web route uses the activity UUID, not its numeric database id.
    from src.db.courses.activities import Activity
    activity = (await db_session.execute(
        select(Activity).where(Activity.id == next_activity_id)
    )).scalars().first()
    if activity is None:
        return {
            "org_slug": org.slug,
            "course_uuid": clean_course,
            "activity_uuid": None,
            "completed": False,
            "path": f"/course/{clean_course}",
        }
    clean_activity = activity.activity_uuid.removeprefix("activity_")
    return {
        "org_slug": org.slug,
        "course_uuid": clean_course,
        "activity_uuid": clean_activity,
        "completed": False,
        "path": f"/course/{clean_course}/activity/{clean_activity}",
    }
