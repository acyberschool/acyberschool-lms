from .models import Membership


def navigation(request):
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated:
        return {"can_manage_people": False}
    can_manage_people = user.is_superuser or Membership.objects.filter(
        user=user,
        role="admin",
    ).exists()
    return {"can_manage_people": can_manage_people}
