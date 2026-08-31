"""Acyberschool native institution control plane.

These endpoints back the Acyberschool-only operator UI. They deliberately live
in core instead of the optional upstream EE package so the hosted LMS can
provision and administer any number of branded institutional tenants.
"""

import json
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.custom_domains import CustomDomain
from src.db.organization_config import OrganizationConfig, OrganizationConfigV2Base
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.security.platform_operator import require_platform_operator
from src.security.rbac.constants import ADMIN_ROLE_ID


router = APIRouter(
    dependencies=[Depends(require_platform_operator)],
)


class InstitutionCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    email: EmailStr
    description: str | None = Field(default=None, max_length=500)
    admin_email: EmailStr | None = None


class InstitutionAdminAssign(BaseModel):
    email: EmailStr


def _managed_host(slug: str) -> str:
    # The public convention is intentionally fixed here. The deployment can
    # still serve institution-owned custom domains through CustomDomain.
    return f"{slug}.classroom.acyberschool.com"


async def _counts(org_id: int, db_session: AsyncSession) -> tuple[int, int]:
    user_count = (await db_session.execute(
        select(func.count(UserOrganization.id)).where(UserOrganization.org_id == org_id)
    )).scalar_one()
    course_count = (await db_session.execute(
        select(func.count(Course.id)).where(Course.org_id == org_id)
    )).scalar_one()
    return int(user_count or 0), int(course_count or 0)


async def _serialize_org(org: Organization, db_session: AsyncSession) -> dict:
    users, courses = await _counts(int(org.id or 0), db_session)
    domains = (await db_session.execute(
        select(CustomDomain).where(CustomDomain.org_id == org.id).order_by(CustomDomain.id)
    )).scalars().all()
    return {
        "id": org.id,
        "org_uuid": org.org_uuid,
        "name": org.name,
        "slug": org.slug,
        "email": org.email,
        "description": org.description,
        "logo_image": org.logo_image,
        "thumbnail_image": org.thumbnail_image,
        "managed_domain": _managed_host(org.slug),
        "users_count": users,
        "courses_count": courses,
        "custom_domains": [
            {
                "id": d.id,
                "domain": d.domain,
                "status": d.status,
                "primary": d.primary,
            }
            for d in domains
        ],
        "creation_date": org.creation_date,
        "update_date": org.update_date,
    }


@router.get("/organizations")
async def list_institutions(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    search: str = Query(default="", max_length=120),
    db_session: AsyncSession = Depends(get_db_session),
):
    query = select(Organization).where(Organization.is_demo.is_(False))
    if search.strip():
        needle = f"%{search.strip()}%"
        query = query.where(
            (Organization.name.ilike(needle))
            | (Organization.slug.ilike(needle))
            | (Organization.email.ilike(needle))
        )

    total = (await db_session.execute(
        select(func.count()).select_from(query.subquery())
    )).scalar_one()
    orgs = (await db_session.execute(
        query.order_by(Organization.id.desc()).offset((page - 1) * limit).limit(limit)
    )).scalars().all()

    return {
        "items": [await _serialize_org(org, db_session) for org in orgs],
        "total": int(total or 0),
        "page": page,
        "limit": limit,
    }


@router.post("/organizations", status_code=status.HTTP_201_CREATED)
async def create_institution(
    payload: InstitutionCreate,
    request: Request,
    operator: PublicUser = Depends(require_platform_operator),
    db_session: AsyncSession = Depends(get_db_session),
):
    existing = (await db_session.execute(
        select(Organization).where(Organization.slug == payload.slug)
    )).scalars().first()
    if existing:
        raise HTTPException(status_code=409, detail="That institution slug is already in use")

    now = str(datetime.now())
    org = Organization(
        name=payload.name,
        slug=payload.slug,
        email=str(payload.email),
        description=payload.description,
        about="",
        socials={},
        links={},
        scripts={},
        previews={},
        explore=False,
        org_uuid=f"org_{uuid4()}",
        creation_date=now,
        update_date=now,
    )
    db_session.add(org)
    await db_session.commit()
    await db_session.refresh(org)

    # Acyberschool remains an administrator of every institution it provisions,
    # which lets the platform team build/co-build courses and administer users.
    operator_membership = UserOrganization(
        user_id=int(operator.id),
        org_id=int(org.id or 0),
        role_id=ADMIN_ROLE_ID,
        creation_date=now,
        update_date=now,
    )
    db_session.add(operator_membership)

    base_config = OrganizationConfigV2Base(config_version="2.0", plan="free")
    org_config = OrganizationConfig(
        org_id=int(org.id or 0),
        config=json.loads(base_config.model_dump_json()),
        creation_date=now,
        update_date=now,
    )
    db_session.add(org_config)
    await db_session.commit()

    # Existing Acyberschool users can be promoted immediately. A new email is
    # returned as pending so the operator UI can send the normal invitation and
    # promote the account as soon as it exists, without silently creating an
    # account or password for someone else.
    admin_status = None
    if payload.admin_email:
        admin_status = await _assign_existing_admin(
            int(org.id or 0), str(payload.admin_email), db_session
        )

    from src.routers.users import _invalidate_session_cache
    _invalidate_session_cache(int(operator.id))

    result = await _serialize_org(org, db_session)
    result["admin_assignment"] = admin_status
    result["classroom_url"] = f"https://{_managed_host(org.slug)}"
    return result


async def _assign_existing_admin(org_id: int, email: str, db_session: AsyncSession) -> dict:
    user = (await db_session.execute(
        select(User).where(func.lower(User.email) == email.lower())
    )).scalars().first()
    if user is None:
        return {
            "status": "pending_account",
            "email": email,
            "message": "Invite this email to create an Acyberschool account, then assign it as institution admin.",
        }

    membership = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.org_id == org_id,
            UserOrganization.user_id == user.id,
        )
    )).scalars().first()
    now = str(datetime.now())
    if membership is None:
        membership = UserOrganization(
            user_id=int(user.id or 0),
            org_id=org_id,
            role_id=ADMIN_ROLE_ID,
            creation_date=now,
            update_date=now,
        )
    else:
        membership.role_id = ADMIN_ROLE_ID
        membership.update_date = now
    db_session.add(membership)
    await db_session.commit()

    from src.routers.users import _invalidate_session_cache
    _invalidate_session_cache(int(user.id or 0))
    return {"status": "assigned", "email": email, "user_id": user.id}


@router.post("/organizations/{org_id}/admins")
async def assign_institution_admin(
    org_id: int,
    payload: InstitutionAdminAssign,
    db_session: AsyncSession = Depends(get_db_session),
):
    org = (await db_session.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Institution not found")
    return await _assign_existing_admin(org_id, str(payload.email), db_session)


@router.get("/organizations/{org_id}")
async def get_institution(
    org_id: int,
    db_session: AsyncSession = Depends(get_db_session),
):
    org = (await db_session.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Institution not found")
    return await _serialize_org(org, db_session)
