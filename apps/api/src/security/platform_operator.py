"""Acyberschool platform-operator authorization.

This is intentionally separate from the upstream Enterprise Edition superadmin
surface. Acyberschool runs a native multi-tenant deployment and needs its own
operator control plane even when the optional ``ee`` package is not present.

Only an authenticated database user with ``is_superadmin=True`` may pass.
Organization-scoped API tokens and anonymous principals are never accepted.
"""

from fastapi import Depends, HTTPException, status
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import APITokenUser, AnonymousUser, PublicUser, SuperadminAPITokenUser
from src.security.auth import get_authenticated_user
from src.security.superadmin import is_user_superadmin


async def require_platform_operator(
    current_user=Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> PublicUser:
    """Require an interactive Acyberschool platform-operator session."""
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    if isinstance(current_user, (APITokenUser, SuperadminAPITokenUser)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform operator access requires an interactive session",
        )

    if not await is_user_superadmin(current_user.id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acyberschool platform operator access required",
        )

    return current_user
