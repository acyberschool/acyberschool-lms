"""Acyberschool course access policy.

Acyberschool is a paid/assigned learning platform. Learners must never gain
course access merely because they are signed into the organization or because a
course was accidentally marked public. Course access is therefore explicit:

- superadmins, org admins/maintainers and active course authors keep access;
- learners must belong to a UserGroup linked to the course;
- anonymous users never receive course content;
- child resources (chapters/activities) inherit the same course rule.

The standard LearnHouse checker remains responsible for all non-course
resources and all write/management permission checks.
"""

from fastapi import HTTPException, Request, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.rbac.config import get_resource_config
from src.security.rbac.resource_access import ResourceAccessChecker as LearnHouseResourceAccessChecker
from src.security.rbac.types import AccessAction, AccessContext, AccessDecision


class AcyberschoolResourceAccessChecker(LearnHouseResourceAccessChecker):
    """LearnHouse RBAC plus Acyberschool's explicit-enrollment course rule."""

    async def _resolve_course_uuid(self, resource_uuid: str) -> str | None:
        current_uuid = resource_uuid
        for _ in range(5):
            config = get_resource_config(current_uuid)
            if not config:
                return None
            if config.resource_type == "courses":
                return current_uuid
            if not config.parent_resource_type:
                return None
            current_uuid = await self._resolve_parent_resource_uuid(current_uuid, config)
            if not current_uuid:
                return None
        return None

    async def _has_explicit_course_enrollment(self, course_uuid: str) -> bool:
        user_id = self._get_user_id()
        if user_id == 0:
            return False

        links = (
            await self.db_session.execute(
                select(UserGroupResource).where(
                    UserGroupResource.resource_uuid == course_uuid
                )
            )
        ).scalars().all()

        # No linked group means no learner access. This is deliberately stricter
        # than LearnHouse's default "all signed-in org members" fallback.
        if not links:
            return False

        group_ids = [link.usergroup_id for link in links]
        membership = (
            await self.db_session.execute(
                select(UserGroupUser).where(
                    UserGroupUser.usergroup_id.in_(group_ids),
                    UserGroupUser.user_id == user_id,
                )
            )
        ).scalars().first()
        return membership is not None

    async def check_access(
        self,
        resource_uuid: str,
        action: AccessAction,
        context: AccessContext = AccessContext.PUBLIC_VIEW,
        require_ownership: bool = False,
    ) -> AccessDecision:
        # Dashboard/admin editing continues to use standard LearnHouse RBAC.
        if action == AccessAction.READ and context == AccessContext.PUBLIC_VIEW:
            course_uuid = await self._resolve_course_uuid(resource_uuid)
            if course_uuid:
                if isinstance(self.current_user, PublicUser) and self.current_user.is_superadmin:
                    return await super().check_access(
                        resource_uuid, action, context, require_ownership
                    )

                # Authors and org admins/maintainers must be able to preview and
                # manage courses even when no learner group has been linked yet.
                if self._get_user_id() != 0:
                    if await self._is_resource_author(course_uuid):
                        return await super().check_access(
                            resource_uuid, action, context, require_ownership
                        )
                    if await self._is_admin_or_maintainer(course_uuid):
                        return await super().check_access(
                            resource_uuid, action, context, require_ownership
                        )

                if isinstance(self.current_user, (AnonymousUser, APITokenUser)):
                    return AccessDecision(
                        allowed=False,
                        reason="This course is available only to assigned learners",
                        resource_uuid=resource_uuid,
                        user_id=self._get_user_id(),
                        action=action.value,
                        context=context.value,
                    )

                if not await self._has_explicit_course_enrollment(course_uuid):
                    return AccessDecision(
                        allowed=False,
                        reason="You have not been assigned to this course",
                        resource_uuid=resource_uuid,
                        user_id=self._get_user_id(),
                        action=action.value,
                        context=context.value,
                    )

        return await super().check_access(resource_uuid, action, context, require_ownership)


def _get_request_checker(
    request: Request,
    db_session: AsyncSession,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> AcyberschoolResourceAccessChecker:
    existing = getattr(request.state, "rbac_checker", None)
    if (
        isinstance(existing, AcyberschoolResourceAccessChecker)
        and existing.db_session is db_session
        and existing.current_user is current_user
    ):
        return existing

    checker = AcyberschoolResourceAccessChecker(request, db_session, current_user)
    try:
        request.state.rbac_checker = checker
    except Exception:
        pass
    return checker


async def check_acyberschool_resource_access(
    request: Request,
    db_session: AsyncSession,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    resource_uuid: str,
    action: AccessAction,
    context: AccessContext = AccessContext.PUBLIC_VIEW,
    require_ownership: bool = False,
    raise_on_deny: bool = True,
) -> AccessDecision:
    checker = _get_request_checker(request, db_session, current_user)
    decision = await checker.check_access(
        resource_uuid, action, context, require_ownership
    )
    if not decision.allowed and raise_on_deny:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=decision.reason,
        )
    return decision
