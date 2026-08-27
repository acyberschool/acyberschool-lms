from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


class LearningAttachment(SQLModel, table=True):
    """A scanned learner file or validated external link attached to learning work."""

    __tablename__ = "learning_attachment"

    id: Optional[int] = Field(default=None, primary_key=True)
    attachment_uuid: str = Field(index=True, unique=True)
    user_id: int = Field(index=True)
    org_id: int = Field(index=True)
    context_type: str = Field(index=True)
    context_uuid: str = Field(index=True)
    kind: str = Field(index=True)  # file | link
    original_name: str = ""
    stored_name: str = ""
    public_path: str = ""
    external_url: str = ""
    scan_status: str = Field(default="clean", index=True)
    created_at: str = Field(default_factory=utc_now_iso)


class LearningAttachmentRead(SQLModel):
    id: int
    attachment_uuid: str
    user_id: int
    org_id: int
    context_type: str
    context_uuid: str
    kind: str
    original_name: str
    stored_name: str
    public_path: str
    external_url: str
    scan_status: str
    created_at: str
