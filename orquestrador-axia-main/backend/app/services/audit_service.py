from __future__ import annotations

from typing import TYPE_CHECKING, Any
from .supabase_service import SupabaseService

if TYPE_CHECKING:
    from .auth_service import CurrentUser


class AuditService:
    def __init__(self) -> None:
        self.supabase = SupabaseService()

    def log(
        self,
        *,
        user: CurrentUser | None,
        action: str,
        entity_type: str,
        entity_id: str | None,
        workflow_id: str | None = None,
        details: dict[str, Any] | None = None,
        old_values: dict[str, Any] | None = None,
        new_values: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self.supabase.insert(
            "audit_logs",
            {
                "user_id": user.id if user else None,
                "workflow_id": workflow_id,
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "details": details or {},
                "old_values": old_values,
                "new_values": new_values,
            },
            use_service_role=True,
        )
