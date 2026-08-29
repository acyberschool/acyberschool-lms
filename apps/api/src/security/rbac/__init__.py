"""
RBAC (Role-Based Access Control) Module

Acyberschool uses LearnHouse's unified RBAC system with one deliberate
course-access override: learners only receive course content when they belong to
a UserGroup explicitly linked to that course. This prevents accidental access
to paid programmes while retaining the standard admin/author permission model.
"""

from src.security.rbac.types import (
    AccessAction,
    AccessContext,
    AccessDecision,
    ResourceConfig,
)

from src.security.rbac.config import (
    RESOURCE_CONFIGS,
    get_resource_config,
    get_resource_type,
)

# Acyberschool checker: standard LearnHouse RBAC + explicit learner enrollment.
from src.security.rbac.acyberschool_access import (
    AcyberschoolResourceAccessChecker as ResourceAccessChecker,
    check_acyberschool_resource_access as check_resource_access,
)

# Dependencies are imported after the checker above. They normally import the
# base LearnHouse checker directly; we replace that module global below so
# FastAPI dependency-based endpoints enforce the same Acyberschool policy.
from src.security.rbac.dependencies import (
    require_resource_access,
    require_read_access,
    require_write_access,
    require_create_access,
    require_dashboard_access,
    CourseAccess,
    PodcastAccess,
    CommunityAccess,
)
import src.security.rbac.dependencies as _rbac_dependencies

from src.security.rbac.rbac import (
    check_usergroup_access,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_author,
    authorization_verify_based_on_roles,
    authorization_verify_based_on_org_admin_status,
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_if_user_is_anon,
    authorization_verify_api_token_permissions,
)

from src.security.rbac.utils import (
    check_element_type,
    get_element_organization_id,
)

from src.security.rbac.constants import (
    ADMIN_ROLE_ID,
    MAINTAINER_ROLE_ID,
    ADMIN_ROLE_IDS,
    ADMIN_OR_MAINTAINER_ROLE_IDS,
    is_admin,
    is_admin_or_maintainer,
    has_elevated_privileges,
)

_rbac_dependencies.ResourceAccessChecker = ResourceAccessChecker

__all__ = [
    "AccessAction",
    "AccessContext",
    "AccessDecision",
    "ResourceConfig",
    "RESOURCE_CONFIGS",
    "get_resource_config",
    "get_resource_type",
    "ResourceAccessChecker",
    "check_resource_access",
    "require_resource_access",
    "require_read_access",
    "require_write_access",
    "require_create_access",
    "require_dashboard_access",
    "CourseAccess",
    "PodcastAccess",
    "CommunityAccess",
    "check_usergroup_access",
    "authorization_verify_if_element_is_public",
    "authorization_verify_if_user_is_author",
    "authorization_verify_based_on_roles",
    "authorization_verify_based_on_org_admin_status",
    "authorization_verify_based_on_roles_and_authorship",
    "authorization_verify_if_user_is_anon",
    "authorization_verify_api_token_permissions",
    "check_element_type",
    "get_element_organization_id",
    "ADMIN_ROLE_ID",
    "MAINTAINER_ROLE_ID",
    "ADMIN_ROLE_IDS",
    "ADMIN_OR_MAINTAINER_ROLE_IDS",
    "is_admin",
    "is_admin_or_maintainer",
    "has_elevated_privileges",
]
