from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from .audit_service import AuditService
from .auth_service import CurrentUser, create_auth_user, delete_auth_user, list_auth_user_metadata, update_auth_user_metadata
from .email_service import EmailService
from .supabase_service import SupabaseService


STAGES = ["Recebimento", "Contabilizacao", "Apuracao", "Consolidacao"]
ROUTINES = ["mensal", "trimestral", "semestral", "anual"]
TEMPLATE_OPERATIONAL_COLUMNS = {"deadline_type", "deadline_days", "notify_team", "team_email_snapshot"}
ACTIVITY_OPERATIONAL_COLUMNS = {
    "deadline_type",
    "deadline_days",
    "notify_team",
    "team_email_snapshot",
    "approval_notification_sent_at",
    "rejection_notification_sent_at",
    "reminder_notification_sent_at",
}
USER_TEAM_COLUMNS = {"team_name", "team_email"}


class WorkflowError(Exception):
    pass


class WorkflowService:
    def __init__(self) -> None:
        self.supabase = SupabaseService()
        self.audit = AuditService()

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _today(self) -> date:
        return datetime.now(timezone.utc).date()

    def _postgrest_error_code(self, error: Exception) -> str:
        response = getattr(error, "response", None)
        if response is None:
            return ""
        try:
            return str(response.json().get("code") or "")
        except (TypeError, ValueError, AttributeError):
            return ""

    def _fallback_registry_rows(self, entity_type: str) -> list[dict[str, Any]]:
        events = self.supabase.select(
            "audit_logs",
            filters={"entity_type": f"eq.{entity_type}"},
            order="created_at.asc",
        )
        rows: dict[str, dict[str, Any]] = {}
        for event in events:
            entity_id = event.get("entity_id")
            if not entity_id:
                continue
            if str(event.get("action", "")).endswith(".deleted"):
                rows.pop(entity_id, None)
                continue
            values = event.get("new_values") or event.get("details") or {}
            if values:
                rows[entity_id] = {**rows.get(entity_id, {}), **values, "id": entity_id}
        return sorted(rows.values(), key=lambda row: str(row.get("name") or row.get("holiday_date") or "").casefold())

    def _save_fallback_registry(
        self,
        *,
        user: CurrentUser,
        entity_type: str,
        entity_id: str,
        action: str,
        old_values: dict[str, Any] | None,
        new_values: dict[str, Any] | None,
    ) -> dict[str, Any]:
        self.audit.log(
            user=user,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            old_values=old_values,
            new_values=new_values,
        )
        return {**(new_values or {}), "id": entity_id}

    def _list_named_registry(self, table: str, entity_type: str) -> list[dict[str, Any]]:
        try:
            table_rows = self.supabase.select(table, order="name.asc")
        except Exception as error:
            if self._postgrest_error_code(error) != "PGRST205":
                raise
            return self._fallback_registry_rows(entity_type)
        fallback_rows = self._fallback_registry_rows(entity_type)
        merged = {row["id"]: row for row in fallback_rows}
        merged.update({row["id"]: row for row in table_rows})
        return sorted(merged.values(), key=lambda row: str(row.get("name") or "").casefold())

    def _create_named_registry(self, table: str, entity_type: str, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_admin(user)
        name = str(payload.get("name") or "").strip()
        if not name:
            raise WorkflowError("Informe o nome do cadastro.")
        values = {"name": name, "is_active": bool(payload.get("is_active", True))}
        if table == "teams":
            values["email"] = str(payload.get("email") or "").strip().lower() or None
        try:
            return self.supabase.insert(table, values)
        except Exception as error:
            if self._postgrest_error_code(error) != "PGRST205":
                raise
            if any(str(row.get("name", "")).casefold() == name.casefold() for row in self._fallback_registry_rows(entity_type)):
                raise WorkflowError("Ja existe um cadastro com este nome.")
            entity_id = str(uuid4())
            return self._save_fallback_registry(user=user, entity_type=entity_type, entity_id=entity_id, action=f"{entity_type}.created", old_values=None, new_values=values)

    def _update_named_registry(self, table: str, entity_type: str, item_id: str, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_admin(user)
        allowed = {key: payload[key] for key in ("name", "email", "is_active") if key in payload}
        if "name" in allowed:
            allowed["name"] = str(allowed["name"]).strip()
            if not allowed["name"]:
                raise WorkflowError("Informe o nome do cadastro.")
        try:
            updated_table_row = self.supabase.update(table, {"id": f"eq.{item_id}"}, allowed)
            if updated_table_row:
                return updated_table_row
        except Exception as error:
            if self._postgrest_error_code(error) != "PGRST205":
                raise
        existing = next((row for row in self._fallback_registry_rows(entity_type) if row["id"] == item_id), None)
        if not existing:
            raise WorkflowError("Cadastro nao encontrado.")
        updated = {**existing, **allowed}
        return self._save_fallback_registry(user=user, entity_type=entity_type, entity_id=item_id, action=f"{entity_type}.updated", old_values=existing, new_values=updated)

    def _delete_named_registry(self, table: str, entity_type: str, item_id: str, user: CurrentUser) -> None:
        self._require_admin(user)
        try:
            deleted = self.supabase.delete(table, {"id": f"eq.{item_id}"})
            if deleted:
                return
        except Exception as error:
            if self._postgrest_error_code(error) != "PGRST205":
                raise
        existing = next((row for row in self._fallback_registry_rows(entity_type) if row["id"] == item_id), None)
        if not existing:
            raise WorkflowError("Cadastro nao encontrado.")
        self._save_fallback_registry(user=user, entity_type=entity_type, entity_id=item_id, action=f"{entity_type}.deleted", old_values=existing, new_values=None)
    def _is_missing_column_error(self, error: Exception) -> bool:
        return self._postgrest_error_code(error) in {"42703", "PGRST204"}

    def _legacy_storage_role(self, role: str) -> str:
        return "admin" if role in {"admin", "usuario_chave"} else "user"

    def _operational_role(self, role: str | None) -> str:
        normalized = str(role or "consulta")
        return {"user": "usuario", "admin": "usuario_chave"}.get(normalized, normalized)

    def _enrich_users_from_auth(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        try:
            metadata_by_id = list_auth_user_metadata()
        except Exception:
            metadata_by_id = {}
        return [
            {
                **row,
                "role": self._operational_role(metadata_by_id.get(row["id"], {}).get("operational_role") or row.get("role")),
                "team_name": metadata_by_id.get(row["id"], {}).get("team_name") or row.get("team_name"),
                "team_email": metadata_by_id.get(row["id"], {}).get("team_email") or row.get("team_email"),
            }
            for row in rows
        ]

    def _insert_compatible(self, resource: str, payload: dict[str, Any], optional_columns: set[str]) -> dict[str, Any]:
        try:
            return self.supabase.insert(resource, payload)
        except Exception as error:
            if not self._is_missing_column_error(error):
                raise
            return self.supabase.insert(resource, {key: value for key, value in payload.items() if key not in optional_columns})

    def _update_compatible(self, resource: str, filters: dict[str, str], payload: dict[str, Any], optional_columns: set[str]) -> dict[str, Any]:
        try:
            return self.supabase.update(resource, filters, payload)
        except Exception as error:
            if not self._is_missing_column_error(error):
                raise
            compatible_payload = {key: value for key, value in payload.items() if key not in optional_columns}
            if not compatible_payload:
                return self.supabase.get_one(resource, filters=filters) or {}
            return self.supabase.update(resource, filters, compatible_payload)

    def _mark_notification_sent(self, activity_id: str, field: str, value: str) -> None:
        self._update_compatible(
            "workflow_activities",
            {"id": f"eq.{activity_id}"},
            {field: value},
            ACTIVITY_OPERATIONAL_COLUMNS,
        )

    def _in_filter(self, values: list[str]) -> str:
        quoted = ",".join(f'"{value}"' for value in values)
        return f"in.({quoted})"

    def _empty_uuid_filter(self, column: str) -> dict[str, str]:
        return {column: "eq.00000000-0000-0000-0000-000000000000"}

    def _serialize_activity(
        self,
        activity: dict[str, Any],
        *,
        dependencies: list[dict[str, Any]],
        attachments: list[dict[str, Any]],
        profiles_by_id: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            **activity,
            "responsible_user": profiles_by_id.get(activity.get("responsible_user_id")),
            "responsible_backup_user": profiles_by_id.get(activity.get("responsible_backup_user_id")),
            "approver_user": profiles_by_id.get(activity.get("approver_user_id")),
            "dependencies": dependencies,
            "attachments": attachments,
        }

    def _activity_rule_map(self, activity_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not activity_ids:
            return {}
        wanted = set(activity_ids)
        return {
            row["id"]: row
            for row in self._fallback_registry_rows("activity_deadline_rule")
            if row["id"] in wanted
        }

    def _enrich_activity_rules(self, activities: list[dict[str, Any]]) -> list[dict[str, Any]]:
        rules = self._activity_rule_map([row["id"] for row in activities])
        return [{**rules.get(row["id"], {}), **row} for row in activities]

    def _save_activity_rule(self, activity: dict[str, Any], user: CurrentUser) -> None:
        rule = {
            "deadline_type": activity.get("deadline_type") or "fixed_date",
            "deadline_days": activity.get("deadline_days"),
        }
        previous = self._activity_rule_map([activity["id"]]).get(activity["id"])
        self._save_fallback_registry(
            user=user,
            entity_type="activity_deadline_rule",
            entity_id=activity["id"],
            action="activity_deadline_rule.updated" if previous else "activity_deadline_rule.created",
            old_values=previous,
            new_values=rule,
        )

    def _require_admin(self, user: CurrentUser) -> None:
        if not user.is_admin:
            raise WorkflowError("Acesso restrito a administradores.")

    def _require_activity_manager(self, user: CurrentUser) -> None:
        if user.role not in {"admin", "usuario_chave", "usuario", "user"}:
            raise WorkflowError("Seu perfil possui apenas permissao de consulta.")

    def _require_key_user(self, user: CurrentUser) -> None:
        if user.role not in {"admin", "usuario_chave"}:
            raise WorkflowError("Acesso restrito ao usuario-chave.")

    def _holiday_dates(self, _company_name: str | None = None) -> set[str]:
        """Feriados pertencem a um calendário único, independente da empresa."""
        try:
            holiday_rows = self.supabase.select("company_holidays", select="holiday_date")
        except Exception as error:
            if self._postgrest_error_code(error) != "PGRST205":
                raise
            holiday_rows = self._fallback_registry_rows("company_holiday")
        return {row["holiday_date"] for row in holiday_rows if row.get("holiday_date")}

    def _is_business_day(self, value: date, company_name: str | None) -> bool:
        return value.weekday() < 5 and value.isoformat() not in self._holiday_dates(company_name)

    def _business_day_after(self, start: date, days: int, company_name: str | None) -> date:
        """Move a date by business days, in either direction, respecting holidays."""
        holiday_dates = self._holiday_dates(company_name)
        current = start
        remaining = abs(days)
        direction = 1 if days >= 0 else -1
        while remaining:
            current += timedelta(days=direction)
            if current.weekday() < 5 and current.isoformat() not in holiday_dates:
                remaining -= 1
        return current

    def _last_business_day_of_previous_month(self, reference: date, company_name: str | None) -> date:
        return self._business_day_after(reference.replace(day=1), -1, company_name)

    def _deadline_from_month_close(self, reference: date, days: int, company_name: str | None) -> date:
        return self._business_day_after(
            self._last_business_day_of_previous_month(reference, company_name), days, company_name
        )

    def _deadline_from_workflow_base(self, base: date, days: int) -> date:
        return self._business_day_after(base, days, None)

    def _shift_date_by_routine(self, value: str, routine: str) -> str:
        """Advances a date to the next monthly, quarterly, semiannual or annual cycle."""
        import calendar

        source = date.fromisoformat(str(value)[:10])
        months_to_add = {"mensal": 1, "trimestral": 3, "semestral": 6, "anual": 12}[routine]
        target_month_index = source.month - 1 + months_to_add
        target_year = source.year + target_month_index // 12
        target_month = target_month_index % 12 + 1
        return source.replace(year=target_year, month=target_month, day=min(source.day, calendar.monthrange(target_year, target_month)[1])).isoformat()

    def _activity_recipients(
        self,
        activity: dict[str, Any],
        *,
        roles: tuple[str, ...] = ("responsible", "backup"),
        include_team: bool = True,
    ) -> list[str]:
        recipients: list[str] = []
        user_ids = {
            "responsible": activity.get("responsible_user_id"),
            "backup": activity.get("responsible_backup_user_id"),
            "approver": activity.get("approver_user_id"),
        }
        for role in roles:
            user_id = user_ids.get(role)
            if user_id:
                profile = self.supabase.get_one("user_profiles", filters={"id": f"eq.{user_id}"})
                if profile and profile.get("is_active"):
                    recipients.append(str(profile["email"]))
        if include_team and activity.get("notify_team") and activity.get("team_email_snapshot"):
            recipients.append(str(activity["team_email_snapshot"]))
        return list(dict.fromkeys(recipients))

    def _send_activity_notification(
        self,
        activity: dict[str, Any],
        subject: str,
        text: str,
        *,
        roles: tuple[str, ...] = ("responsible", "backup"),
        include_team: bool = True,
        user: CurrentUser | None = None,
    ) -> bool:
        recipients = self._activity_recipients(activity, roles=roles, include_team=include_team)
        all_sent = bool(recipients)
        for recipient in recipients:
            try:
                EmailService().send_email(to_email=recipient, subject=subject, text=text, use_redirect=False)
                self.audit.log(user=user, workflow_id=activity["workflow_id"], action="email.sent", entity_type="workflow_activity", entity_id=activity["id"], details={"subject": subject, "to": recipient})
            except Exception as error:
                all_sent = False
                self.audit.log(user=user, workflow_id=activity["workflow_id"], action="email.failed", entity_type="workflow_activity", entity_id=activity["id"], details={"to": recipient, "error": str(error)})
        return all_sent

    def _notify_workflow_started(self, workflow_id: str, user: CurrentUser) -> None:
        for activity in self.supabase.select("workflow_activities", filters={"workflow_id": f"eq.{workflow_id}"}):
            self._send_activity_notification(activity, "Workflow iniciado", f"Prezado(a), o fechamento do mes/ano se iniciou. Verifique no APP Orquestrador as atividades sob sua responsabilidade.\n\nAtenciosamente,\nGestao Integ Contabil, Sist e Controles\nMensagem gerada automaticamente - nao responder.", roles=("responsible", "backup", "approver"), user=user)

    def _send_due_reminders(self, workflow_id: str, user: CurrentUser | None = None) -> None:
        reminder_date = self._today() + timedelta(days=2)
        for activity in self.supabase.select("workflow_activities", filters={"workflow_id": f"eq.{workflow_id}", "expected_end_date": f"eq.{reminder_date.isoformat()}"}):
            if activity.get("status") in {"Concluida", "Reprovada"} or activity.get("reminder_notification_sent_at"):
                continue
            self._send_activity_notification(activity, "Lembrete de prazo da atividade", f"Prezado(a), solicitamos a conclusao da atividade '{activity['name_snapshot']}' ate {activity['expected_end_date']} conforme definido no cronograma de fechamento.", roles=("responsible", "approver"), user=user)
            self._mark_notification_sent(activity["id"], "reminder_notification_sent_at", self._now_iso())

    def _validate_routine(self, routine: str) -> None:
        if routine not in ROUTINES:
            raise WorkflowError("Rotina invalida.")

    def _validate_stage(self, stage: str) -> None:
        if stage not in STAGES:
            raise WorkflowError("Etapa invalida.")

    def _validate_date_range(self, start_date: str, expected_end_date: str) -> None:
        if date.fromisoformat(expected_end_date) < date.fromisoformat(start_date):
            raise WorkflowError("A data final prevista nao pode ser menor que a data de inicio.")

    def _workflow_execution_status(self, workflow: dict[str, Any], activities: list[dict[str, Any]]) -> str:
        completed = sum(1 for item in activities if item.get("status") == "Concluida")
        if activities and completed == len(activities):
            return "Concluido"
        # A execução só começa por uma ação consciente de ativação. Datas são
        # referências de prazo e nunca devem iniciar ou notificar um workflow.
        return "Em andamento" if workflow.get("is_active", False) else "Nao iniciado"

    def _profile_map(self, user_ids: set[str]) -> dict[str, dict[str, Any]]:
        if not user_ids:
            return {}
        rows = self.supabase.select(
            "user_profiles",
            filters={"id": self._in_filter(list(user_ids))},
        )
        return {row["id"]: row for row in rows}

    def _active_user_options(self) -> list[dict[str, Any]]:
        return self._enrich_users_from_auth(
            self.supabase.select(
                "user_profiles",
                select="id,email,name,role,area,is_active,first_login_required",
                filters={"is_active": "eq.true"},
                order="name.asc",
            )
        )

    def _legacy_user_by_email(self, email: str) -> dict[str, Any] | None:
        return self.supabase.get_one(
            "app_users",
            filters={"email": f"eq.{email.strip().lower()}"},
        )

    def _ensure_legacy_user(self, user: CurrentUser) -> dict[str, Any]:
        existing = self._legacy_user_by_email(user.email)
        if existing:
            return existing
        return self.supabase.insert(
            "app_users",
            {
                "id": user.id,
                "email": user.email.strip().lower(),
                "full_name": user.name,
                "role_name": user.role,
                "is_active": True,
                "is_online": False,
            },
        )

    def _legacy_workflow_to_app(self, workflow: dict[str, Any]) -> dict[str, Any]:
        period = str(workflow.get("period") or "")
        month = 0
        year = 0
        if "/" in period:
            month_part, year_part = period.split("/", 1)
            if month_part.isdigit():
                month = int(month_part)
            if year_part.isdigit():
                year = int(year_part)
        return {
            "id": workflow["id"],
            "name": workflow["name"],
            "description": workflow.get("description"),
            "routine": str(workflow.get("routine") or "").strip().lower(),
            "month": month,
            "year": year,
            "start_date": str(workflow.get("start_at") or "")[:10],
            "last_business_day": str(workflow.get("start_at") or "")[:10],
            "expected_end_date": str(workflow.get("due_at") or "")[:10],
            "created_by": workflow.get("created_by"),
            "created_at": workflow.get("created_at"),
            "updated_at": workflow.get("updated_at"),
            "status": workflow.get("status"),
            "is_active": workflow.get("is_active", workflow.get("status") not in {"Nao iniciado", "Planejado", "Inativo", "Cancelado", "Concluido"}),
        }

    def _workflow_insert_payload(self, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        legacy_user = self._ensure_legacy_user(user)
        return {
            "name": payload["name"].strip(),
            "description": str(payload.get("description", "")).strip(),
            "routine": payload["routine"].capitalize(),
            "period": f"{int(payload['month']):02d}/{int(payload['year'])}",
            "start_at": f"{payload.get('last_business_day') or payload['start_date']}T00:00:00+00:00",
            "due_at": f"{payload['expected_end_date']}T00:00:00+00:00",
            "status": "Nao iniciado",
            "is_active": False,
            "created_by": legacy_user["id"],
        }, legacy_user

    def _list_accessible_workflow_ids(self, user: CurrentUser) -> list[str]:
        if user.is_admin:
            workflows = self.supabase.select("workflows", select="id")
            return [row["id"] for row in workflows]
        legacy_user = self._ensure_legacy_user(user)
        workflows = self.supabase.select(
            "workflow_participants",
            select="workflow_id",
            filters={"user_id": f"eq.{legacy_user['id']}"},
        )
        return [row["workflow_id"] for row in workflows]

    def _require_workflow_access(self, workflow_id: str, user: CurrentUser, *, write: bool = False) -> dict[str, Any]:
        workflow = self.supabase.get_one("workflows", filters={"id": f"eq.{workflow_id}"})
        if not workflow:
            raise WorkflowError("Workflow nao encontrado.")
        if write and not user.is_admin:
            legacy_user = self._ensure_legacy_user(user)
            participant = self.supabase.get_one(
                "workflow_participants",
                filters={"workflow_id": f"eq.{workflow_id}", "user_id": f"eq.{legacy_user['id']}"},
            )
            if workflow["created_by"] != legacy_user["id"] and (
                not participant or participant["access_level"] not in {"owner", "editor"}
            ):
                raise WorkflowError("Voce nao possui permissao de edicao neste workflow.")
        return workflow

    def _require_activity_access(self, activity_id: str, user: CurrentUser, *, write: bool = False) -> dict[str, Any]:
        activity = self.supabase.get_one("workflow_activities", filters={"id": f"eq.{activity_id}"})
        if not activity:
            raise WorkflowError("Atividade nao encontrada.")
        self._require_workflow_access(activity["workflow_id"], user, write=write)
        return activity

    def _stage_defaults(self, stage: str) -> dict[str, Any]:
        setting = self.supabase.get_one(
            "stage_responsibility_settings",
            filters={"stage_name": f"eq.{stage}"},
        )
        return setting or {}

    def _activity_dependencies(self, activity_ids: list[str]) -> list[dict[str, Any]]:
        if not activity_ids:
            return []
        return self.supabase.select(
            "workflow_activity_dependencies",
            filters={"workflow_activity_id": self._in_filter(activity_ids)},
        )

    def _attachment_map(self, activity_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        if not activity_ids:
            return {}
        rows = self.supabase.select(
            "workflow_activity_attachments",
            filters={"workflow_activity_id": self._in_filter(activity_ids)},
            order="created_at.desc",
        )
        mapped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            mapped[row["workflow_activity_id"]].append(row)
        return mapped

    def _dependency_map(self, activity_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        rows = self._activity_dependencies(activity_ids)
        mapped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            mapped[row["workflow_activity_id"]].append(row)
        return mapped

    def _validate_template_dependencies(self, template_id: str, dependency_ids: list[str]) -> None:
        if template_id in dependency_ids:
            raise WorkflowError("Uma atividade nao pode depender dela mesma.")
        all_dependencies = self.supabase.select("activity_template_dependencies")
        graph: dict[str, set[str]] = defaultdict(set)
        for row in all_dependencies:
            graph[row["activity_template_id"]].add(row["depends_on_template_id"])
        graph[template_id] = set(dependency_ids)

        seen: set[str] = set()
        visiting: set[str] = set()

        def visit(node: str) -> None:
            if node in visiting:
                raise WorkflowError("Dependencia circular detectada entre templates.")
            if node in seen:
                return
            visiting.add(node)
            for child in graph.get(node, set()):
                visit(child)
            visiting.remove(node)
            seen.add(node)

        visit(template_id)

    def _validate_workflow_dependency_graph(self, workflow_id: str, updates: dict[str, set[str]]) -> None:
        activity_rows = self.supabase.select(
            "workflow_activities",
            select="id",
            filters={"workflow_id": f"eq.{workflow_id}"},
        )
        valid_ids = {row["id"] for row in activity_rows}
        existing = self.supabase.select(
            "workflow_activity_dependencies",
            filters={"workflow_id": f"eq.{workflow_id}"},
        ) if False else self.supabase.select(
            "workflow_activity_dependencies",
            filters={"workflow_activity_id": self._in_filter(list(valid_ids))} if valid_ids else self._empty_uuid_filter("workflow_activity_id"),
        )

        graph: dict[str, set[str]] = defaultdict(set)
        for row in existing:
            graph[row["workflow_activity_id"]].add(row["depends_on_workflow_activity_id"])

        for key, values in updates.items():
            if key in values:
                raise WorkflowError("Uma atividade nao pode depender dela mesma.")
            if key not in valid_ids:
                valid_ids.add(key)
            invalid_dependencies = [value for value in values if value not in valid_ids]
            if invalid_dependencies:
                raise WorkflowError("Dependencia informada nao pertence ao workflow atual.")
            graph[key] = set(values)

        seen: set[str] = set()
        visiting: set[str] = set()

        def visit(node: str) -> None:
            if node in visiting:
                raise WorkflowError("Dependencia circular detectada no workflow.")
            if node in seen:
                return
            visiting.add(node)
            for child in graph.get(node, set()):
                visit(child)
            visiting.remove(node)
            seen.add(node)

        for node in set(graph) | valid_ids:
            visit(node)

    def _notify_activity_released(self, activity: dict[str, Any], workflow_id: str, user: CurrentUser | None) -> None:
        if activity.get("notification_sent_at"):
            return
        self._send_activity_notification(activity, "Atividade disponivel para execucao", f"Prezado(a), a atividade '{activity['name_snapshot']}' esta disponivel para execucao.\n\nAtenciosamente,\nGestao Integ Contabil, Sist e Controles\nMensagem gerada automaticamente - nao responder.", roles=("responsible", "approver"), user=user)
        try:
            self.supabase.update(
                "workflow_activities",
                {"id": f"eq.{activity['id']}"},
                {"notification_sent_at": self._now_iso()},
            )
            self.audit.log(
                user=user,
                workflow_id=workflow_id,
                action="email.sent",
                entity_type="workflow_activity",
                entity_id=activity["id"],
                details={"subject": "Atividade disponivel para execucao"},
            )
        except Exception as error:
            self.audit.log(
                user=user,
                workflow_id=workflow_id,
                action="email.failed",
                entity_type="workflow_activity",
                entity_id=activity["id"],
                details={"error": str(error)},
            )

    def _recompute_activity_statuses(
        self,
        workflow_id: str,
        user: CurrentUser | None = None,
        *,
        notify_releases: bool = True,
    ) -> None:
        workflow = self.supabase.get_one("workflows", filters={"id": f"eq.{workflow_id}"})
        # Nenhuma atividade é liberada enquanto o workflow estiver aguardando
        # ativação manual. Isso também impede e-mails antecipados.
        if not workflow or not workflow.get("is_active", False):
            return
        activities = self.supabase.select(
            "workflow_activities",
            filters={"workflow_id": f"eq.{workflow_id}"},
            order="start_date.asc",
        )
        if not activities:
            return

        activity_by_id = {activity["id"]: activity for activity in activities}
        dependency_map = self._dependency_map(list(activity_by_id.keys()))
        attachment_map = self._attachment_map(list(activity_by_id.keys()))
        today = self._today()

        for activity in activities:
            if activity["status"] in {"Concluida", "Reprovada", "Em revisao", "Pendente de aprovacao"}:
                continue
            dependencies = dependency_map.get(activity["id"], [])
            dependency_done = all(
                activity_by_id[dependency["depends_on_workflow_activity_id"]]["status"] == "Concluida"
                for dependency in dependencies
            )
            next_status = "Bloqueada"
            if dependency_done:
                due_date = date.fromisoformat(activity["expected_end_date"])
                next_status = "Atrasada" if due_date < today else "Nao iniciada"
            if next_status == activity["status"]:
                continue

            previous_status = activity["status"]
            updated = self.supabase.update(
                "workflow_activities",
                {"id": f"eq.{activity['id']}"},
                {
                    "status": next_status,
                    "released_at": (
                        self._now_iso()
                        if next_status in {"Nao iniciada", "Atrasada"} and not activity.get("released_at")
                        else activity.get("released_at")
                    ),
                },
            )
            self.audit.log(
                user=user,
                workflow_id=workflow_id,
                action="activity.status_changed",
                entity_type="workflow_activity",
                entity_id=activity["id"],
                details={"reason": "dependency-evaluation", "attachments": len(attachment_map.get(activity["id"], []))},
                old_values={"status": previous_status},
                new_values={"status": updated["status"]},
            )
            if next_status == "Atrasada" and not activity.get("overdue_logged_at"):
                self.supabase.update(
                    "workflow_activities",
                    {"id": f"eq.{activity['id']}"},
                    {"overdue_logged_at": self._now_iso()},
                )
                self.audit.log(
                    user=user,
                    workflow_id=workflow_id,
                    action="activity.overdue_entered",
                    entity_type="workflow_activity",
                    entity_id=activity["id"],
                    details={"name": activity["name_snapshot"]},
                )
            if previous_status == "Atrasada" and next_status != "Atrasada":
                self.audit.log(
                    user=user,
                    workflow_id=workflow_id,
                    action="activity.overdue_exited",
                    entity_type="workflow_activity",
                    entity_id=activity["id"],
                    details={"name": activity["name_snapshot"]},
                )
            if next_status in {"Nao iniciada", "Atrasada"} and previous_status == "Bloqueada":
                self.audit.log(
                    user=user,
                    workflow_id=workflow_id,
                    action="activity.released",
                    entity_type="workflow_activity",
                    entity_id=activity["id"],
                    details={"name": activity["name_snapshot"]},
                )
                if notify_releases:
                    self._notify_activity_released(updated, workflow_id, user)

    def _notify_next_activity_by_date(self, completed_activity: dict[str, Any], user: CurrentUser | None) -> None:
        later_activities = self.supabase.select(
            "workflow_activities",
            filters={
                "workflow_id": f"eq.{completed_activity['workflow_id']}",
                "start_date": f"gt.{completed_activity['start_date']}",
            },
            order="start_date.asc",
            limit=1,
        )
        if later_activities:
            self._notify_activity_released(later_activities[0], completed_activity["workflow_id"], user)

    def _return_previous_activity_for_review(self, rejected_activity: dict[str, Any], user: CurrentUser) -> None:
        previous_rows = self.supabase.select(
            "workflow_activities",
            filters={
                "workflow_id": f"eq.{rejected_activity['workflow_id']}",
                "start_date": f"lt.{rejected_activity['start_date']}",
            },
            order="start_date.desc",
            limit=1,
        )
        if not previous_rows:
            return
        previous = previous_rows[0]
        updated = self.supabase.update(
            "workflow_activities",
            {"id": f"eq.{previous['id']}"},
            {"status": "Em revisao", "approval_status": "Em revisao", "completed_at": None, "completed_by": None},
        )
        responsible = self.supabase.get_one("user_profiles", filters={"id": f"eq.{previous.get('responsible_user_id')}"}) if previous.get("responsible_user_id") else None
        if responsible and responsible.get("is_active"):
            try:
                EmailService().send_email(
                    to_email=str(responsible["email"]),
                    subject="Atividade devolvida para revisão",
                    text=f"A atividade posterior '{rejected_activity['name_snapshot']}' foi reprovada. Revise a atividade '{previous['name_snapshot']}'.",
                    use_redirect=False,
                )
            except Exception as error:
                self.audit.log(user=user, workflow_id=previous["workflow_id"], action="email.failed", entity_type="workflow_activity", entity_id=previous["id"], details={"error": str(error)})
        self.audit.log(
            user=user,
            workflow_id=previous["workflow_id"],
            action="workflow_activity.returned_for_review",
            entity_type="workflow_activity",
            entity_id=previous["id"],
            old_values={"status": previous["status"]},
            new_values={"status": updated["status"]},
        )

    def _build_activity_snapshot(self, workflow_id: str, template: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        defaults = self._stage_defaults(payload.get("stage") or template["stage"])
        start_date = payload.get("start_date") or template.get("start_date") or self._today().isoformat()
        deadline_type = payload.get("deadline_type") or template.get("deadline_type") or "fixed_date"
        deadline_days = payload.get("deadline_days", template.get("deadline_days"))
        company = payload.get("company") or template.get("company")
        if deadline_type == "business_days":
            if deadline_days is None:
                raise WorkflowError("Informe a quantidade de dias uteis para o prazo.")
            workflow = self.supabase.get_one("workflows", filters={"id": f"eq.{workflow_id}"})
            base_value = str((workflow or {}).get("start_at") or start_date)[:10]
            expected_end_date = self._deadline_from_workflow_base(date.fromisoformat(base_value), int(deadline_days)).isoformat()
        else:
            expected_end_date = payload.get("expected_end_date") or template.get("expected_end_date") or self._today().isoformat()
        if deadline_type != "business_days":
            self._validate_date_range(start_date, expected_end_date)
        return {
            "workflow_id": workflow_id,
            "activity_template_id": template.get("id"),
            "name_snapshot": payload.get("name") or template["name"],
            "stage_snapshot": payload.get("stage") or template["stage"],
            "routine_snapshot": payload.get("routine") or template["routine"],
            "responsible_user_id": payload.get("responsible_user_id")
            or template.get("responsible_user_id")
            or defaults.get("default_responsible_user_id"),
            "responsible_backup_user_id": payload.get("responsible_backup_user_id")
            or template.get("responsible_backup_user_id")
            or defaults.get("default_backup_user_id"),
            "requires_attachment_snapshot": bool(payload.get("requires_attachment", template.get("requires_attachment", False))),
            "requires_approval_snapshot": bool(payload.get("requires_approval", template.get("requires_approval", False))),
            "approver_user_id": payload.get("approver_user_id") or template.get("approver_user_id"),
            "start_date": start_date,
            "expected_end_date": expected_end_date,
            "company_snapshot": company,
            "deadline_type": deadline_type,
            "deadline_days": int(deadline_days) if deadline_days is not None else None,
            "notify_team": bool(payload.get("notify_team", template.get("notify_team", False))),
            "team_email_snapshot": payload.get("team_email") or template.get("team_email_snapshot"),
            "status": "Bloqueada",
        }

    def _log_dependency_change(
        self,
        *,
        user: CurrentUser,
        workflow_id: str,
        activity_id: str,
        old_dependency_ids: list[str],
        new_dependency_ids: list[str],
    ) -> None:
        if sorted(old_dependency_ids) == sorted(new_dependency_ids):
            return
        self.audit.log(
            user=user,
            workflow_id=workflow_id,
            action="workflow_activity.dependencies_updated",
            entity_type="workflow_activity",
            entity_id=activity_id,
            old_values={"dependency_activity_ids": old_dependency_ids},
            new_values={"dependency_activity_ids": new_dependency_ids},
        )

    def _replace_workflow_activity_dependencies(
        self,
        *,
        workflow_id: str,
        activity_id: str,
        dependency_ids: list[str],
        user: CurrentUser,
    ) -> None:
        current_dependencies = self.supabase.select(
            "workflow_activity_dependencies",
            filters={"workflow_activity_id": f"eq.{activity_id}"},
        )
        old_dependency_ids = [row["depends_on_workflow_activity_id"] for row in current_dependencies]
        self._validate_workflow_dependency_graph(workflow_id, {activity_id: set(dependency_ids)})
        self.supabase.delete("workflow_activity_dependencies", {"workflow_activity_id": f"eq.{activity_id}"})
        if dependency_ids:
            self.supabase.bulk_insert(
                "workflow_activity_dependencies",
                [
                    {
                        "workflow_activity_id": activity_id,
                        "depends_on_workflow_activity_id": dependency_id,
                    }
                    for dependency_id in dependency_ids
                ],
            )
        self._log_dependency_change(
            user=user,
            workflow_id=workflow_id,
            activity_id=activity_id,
            old_dependency_ids=old_dependency_ids,
            new_dependency_ids=dependency_ids,
        )

    def list_workflows(self, user: CurrentUser) -> list[dict[str, Any]]:
        workflow_ids = self._list_accessible_workflow_ids(user)
        if not workflow_ids:
            return []

        workflows = self.supabase.select(
            "workflows",
            filters={"id": self._in_filter(workflow_ids)},
            order="created_at.desc",
        )
        participants = self.supabase.select(
            "workflow_participants",
            filters={"workflow_id": self._in_filter([row["id"] for row in workflows])} if workflows else self._empty_uuid_filter("workflow_id"),
        )
        activities = self.supabase.select(
            "workflow_activities",
            filters={"workflow_id": self._in_filter([row["id"] for row in workflows])} if workflows else self._empty_uuid_filter("workflow_id"),
        )
        profile_ids: set[str] = set()
        profile_ids.update(
            value
            for activity in activities
            for value in (
                activity.get("responsible_user_id"),
                activity.get("responsible_backup_user_id"),
                activity.get("approver_user_id"),
            )
            if value
        )
        profiles_by_id = self._profile_map(profile_ids)

        participant_map: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for participant in participants:
            participant_map[participant["workflow_id"]].append(participant)

        activity_map: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for activity in activities:
            activity_map[activity["workflow_id"]].append(activity)

        response: list[dict[str, Any]] = []
        for workflow in workflows:
            workflow_activities = activity_map.get(workflow["id"], [])
            completed = sum(1 for item in workflow_activities if item["status"] == "Concluida")
            in_progress = sum(
                1
                for item in workflow_activities
                if item["status"] in {"Nao iniciada", "Atrasada", "Pendente de aprovacao"}
            )
            workflow_status = self._workflow_execution_status(workflow, workflow_activities)
            response.append(
                {
                    **self._legacy_workflow_to_app(workflow),
                    "status": workflow_status,
                    "participants": [
                        {**participant, "user": profiles_by_id.get(participant["user_id"])}
                        for participant in participant_map.get(workflow["id"], [])
                    ],
                    "created_by_user": None,
                    "activity_totals": {
                        "completed": completed,
                        "in_progress": in_progress,
                        "total": len(workflow_activities),
                    },
                }
            )
        return response

    def update_workflow(self, workflow_id: str, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_key_user(user)
        workflow = self._require_workflow_access(workflow_id, user, write=True)
        data: dict[str, Any] = {}
        was_active = workflow.get("is_active", workflow.get("status") not in {"Inativo", "Cancelado", "Concluido"})
        if "is_active" in payload:
            requested_active = bool(payload["is_active"])
            if was_active and not requested_active:
                raise WorkflowError("Um workflow ativado nao pode ser inativado.")
            data["is_active"] = requested_active
            if requested_active and not was_active:
                data["status"] = "Em andamento"
        if "name" in payload:
            workflow_name = str(payload["name"]).strip()
            if not workflow_name or not any(character.isalnum() for character in workflow_name):
                raise WorkflowError("Informe um nome valido para o workflow.")
            data["name"] = workflow_name
        if "description" in payload:
            data["description"] = str(payload.get("description") or "").strip()
        if "routine" in payload:
            routine = str(payload["routine"]).strip().lower()
            self._validate_routine(routine)
            data["routine"] = routine.capitalize()
        if "month" in payload or "year" in payload:
            current = self._legacy_workflow_to_app(workflow)
            month = int(payload.get("month", current["month"]))
            year = int(payload.get("year", current["year"]))
            if month < 1 or month > 12 or year < 2000:
                raise WorkflowError("Periodo do workflow invalido.")
            data["period"] = f"{month:02d}/{year}"
        base_changed = "last_business_day" in payload or "start_date" in payload
        if base_changed or "expected_end_date" in payload:
            current = self._legacy_workflow_to_app(workflow)
            start_date = str(payload.get("last_business_day", payload.get("start_date", current["last_business_day"])))[:10]
            expected_end_date = str(payload.get("expected_end_date", current["expected_end_date"]))[:10]
            data["start_at"] = f"{start_date}T00:00:00+00:00"
            data["due_at"] = f"{expected_end_date}T00:00:00+00:00"
        if not data:
            return self._legacy_workflow_to_app(workflow)
        try:
            updated = self.supabase.update("workflows", {"id": f"eq.{workflow_id}"}, data)
        except Exception as error:
            if not self._is_missing_column_error(error) or "is_active" not in data:
                raise
            legacy_data = {key: value for key, value in data.items() if key != "is_active"}
            legacy_data["status"] = "Em andamento" if data["is_active"] else "Nao iniciado"
            updated = self.supabase.update("workflows", {"id": f"eq.{workflow_id}"}, legacy_data)
        if data.get("is_active") and not was_active:
            self._recompute_activity_statuses(workflow_id, user, notify_releases=False)
            self._notify_workflow_started(workflow_id, user)
        if base_changed:
            base = date.fromisoformat(str(updated["start_at"])[:10])
            activities = self._enrich_activity_rules(self.supabase.select("workflow_activities", filters={"workflow_id": f"eq.{workflow_id}"}))
            for activity in activities:
                if activity.get("deadline_type") == "business_days" and activity.get("deadline_days") is not None:
                    self.supabase.update(
                        "workflow_activities",
                        {"id": f"eq.{activity['id']}"},
                        {"expected_end_date": self._deadline_from_workflow_base(base, int(activity["deadline_days"])).isoformat()},
                    )
        self.audit.log(user=user, workflow_id=workflow_id, action="workflow.updated", entity_type="workflow", entity_id=workflow_id, old_values=workflow, new_values=updated)
        return self._legacy_workflow_to_app(updated)

    def duplicate_workflow(self, workflow_id: str, user: CurrentUser) -> dict[str, Any]:
        self._require_key_user(user)
        source = self._require_workflow_access(workflow_id, user)
        source_data = self._legacy_workflow_to_app(source)
        next_start_date = self._shift_date_by_routine(source_data["last_business_day"], source_data["routine"])
        copy = self.create_workflow(
            user,
            {
                **source_data,
                "name": f"{source_data['name']} Copia",
                "month": int(next_start_date[5:7]),
                "year": int(next_start_date[:4]),
                "start_date": next_start_date,
                "last_business_day": next_start_date,
                "expected_end_date": self._shift_date_by_routine(source_data["expected_end_date"], source_data["routine"]),
            },
        )
        source_activities = self._enrich_activity_rules(self.supabase.select("workflow_activities", filters={"workflow_id": f"eq.{workflow_id}"}, order="created_at.asc"))
        mapping: dict[str, str] = {}
        for activity in source_activities:
            payload = {key: value for key, value in activity.items() if key not in {"id", "workflow_id", "created_at", "updated_at", "status", "approval_status", "released_at", "notification_sent_at", "completed_at", "completed_by", "rejected_at", "rejected_by", "overdue_logged_at"}}
            payload["workflow_id"] = copy["id"]
            payload["start_date"] = self._shift_date_by_routine(activity["start_date"], source_data["routine"])
            if activity.get("deadline_type") == "business_days" and activity.get("deadline_days") is not None:
                payload["expected_end_date"] = self._deadline_from_workflow_base(date.fromisoformat(next_start_date), int(activity["deadline_days"])).isoformat()
            else:
                payload["expected_end_date"] = self._shift_date_by_routine(activity["expected_end_date"], source_data["routine"])
            payload["status"] = "Bloqueada"
            payload["approval_status"] = "Nao aplicavel"
            created = self._insert_compatible("workflow_activities", payload, ACTIVITY_OPERATIONAL_COLUMNS)
            self._save_activity_rule({**payload, **created}, user)
            mapping[activity["id"]] = created["id"]
        dependencies = self.supabase.select("workflow_activity_dependencies", filters={"workflow_activity_id": self._in_filter(list(mapping))} if mapping else self._empty_uuid_filter("workflow_activity_id"))
        if dependencies:
            self.supabase.bulk_insert("workflow_activity_dependencies", [{"workflow_activity_id": mapping[row["workflow_activity_id"]], "depends_on_workflow_activity_id": mapping[row["depends_on_workflow_activity_id"]]} for row in dependencies if row["depends_on_workflow_activity_id"] in mapping])
        self._recompute_activity_statuses(copy["id"], user)
        return copy

    def delete_workflow(self, workflow_id: str, user: CurrentUser) -> None:
        self._require_admin(user)
        workflow = self._require_workflow_access(workflow_id, user, write=True)
        self.supabase.delete("workflows", {"id": f"eq.{workflow_id}"})
        self.audit.log(
            user=user,
            workflow_id=None,
            action="workflow.deleted",
            entity_type="workflow",
            entity_id=workflow_id,
            details={"deleted_workflow_id": workflow_id, "name": workflow.get("name")},
            old_values=workflow,
        )

    def delete_workflow_activity(self, activity_id: str, user: CurrentUser) -> None:
        self._require_activity_manager(user)
        activity = self._require_activity_access(activity_id, user, write=True)
        if activity.get("status") in {"Concluida", "Reprovada"} and not user.is_admin:
            raise WorkflowError("Somente o Administrador Master pode excluir uma atividade concluida.")
        self.supabase.delete("workflow_activities", {"id": f"eq.{activity_id}"})
        self.audit.log(user=user, workflow_id=activity["workflow_id"], action="workflow_activity.deleted", entity_type="workflow_activity", entity_id=activity_id, old_values=activity)
        self._recompute_activity_statuses(activity["workflow_id"], user)

    def list_companies(self, user: CurrentUser) -> list[dict[str, Any]]:
        return self._list_named_registry("companies", "company")

    def create_company(self, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_key_user(user)
        name = str(payload.get("name") or "").strip()
        if not name:
            raise WorkflowError("Informe o nome da empresa.")
        try:
            return self.supabase.insert("companies", {"name": name, "is_active": bool(payload.get("is_active", True))})
        except Exception as error:
            if self._postgrest_error_code(error) == "PGRST205":
                existing = self._fallback_registry_rows("company")
                if any(str(row.get("name", "")).casefold() == name.casefold() for row in existing):
                    raise WorkflowError("Ja existe uma empresa com este nome.") from error
                company_id = str(uuid4())
                return self._save_fallback_registry(
                    user=user,
                    entity_type="company",
                    entity_id=company_id,
                    action="company.created",
                    old_values=None,
                    new_values={"name": name, "is_active": bool(payload.get("is_active", True))},
                )
            raise

    def update_company(self, company_id: str, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_key_user(user)
        try:
            updated_table_row = self.supabase.update("companies", {"id": f"eq.{company_id}"}, {key: payload[key] for key in ("name", "is_active") if key in payload})
            if updated_table_row:
                return updated_table_row
        except Exception as error:
            if self._postgrest_error_code(error) != "PGRST205":
                raise
        existing = next((row for row in self._fallback_registry_rows("company") if row["id"] == company_id), None)
        if not existing:
            raise WorkflowError("Empresa nao encontrada.")
        updated = {**existing, **{key: payload[key] for key in ("name", "is_active") if key in payload}}
        return self._save_fallback_registry(user=user, entity_type="company", entity_id=company_id, action="company.updated", old_values=existing, new_values=updated)

    def list_holidays(self, company_id: str | None, user: CurrentUser) -> list[dict[str, Any]]:
        try:
            return self.supabase.select("company_holidays", order="holiday_date.asc")
        except Exception as error:
            if self._postgrest_error_code(error) == "PGRST205":
                return self._fallback_registry_rows("company_holiday")
            raise

    def create_holiday(self, company_id: str | None, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_key_user(user)
        if not payload.get("holiday_date"):
            raise WorkflowError("Informe a data do feriado.")
        try:
            return self.supabase.insert("company_holidays", {"company_id": company_id, "holiday_date": payload["holiday_date"], "description": payload.get("description")})
        except Exception as error:
            if self._postgrest_error_code(error) == "PGRST205":
                holiday_id = str(uuid4())
                return self._save_fallback_registry(
                    user=user,
                    entity_type="company_holiday",
                    entity_id=holiday_id,
                    action="company_holiday.created",
                    old_values=None,
                    new_values={"holiday_date": payload["holiday_date"], "description": payload.get("description")},
                )
            raise

    def delete_holiday(self, holiday_id: str, user: CurrentUser) -> None:
        self._require_key_user(user)
        try:
            self.supabase.delete("company_holidays", {"id": f"eq.{holiday_id}"})
        except Exception as error:
            if self._postgrest_error_code(error) != "PGRST205":
                raise
            existing = next((row for row in self._fallback_registry_rows("company_holiday") if row["id"] == holiday_id), None)
            if not existing:
                raise WorkflowError("Feriado nao encontrado.")
            self._save_fallback_registry(user=user, entity_type="company_holiday", entity_id=holiday_id, action="company_holiday.deleted", old_values=existing, new_values=None)

    def update_holiday(self, holiday_id: str, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_key_user(user)
        try:
            existing = self.supabase.get_one("company_holidays", filters={"id": f"eq.{holiday_id}"})
        except Exception as error:
            if self._postgrest_error_code(error) != "PGRST205":
                raise
            existing = next((row for row in self._fallback_registry_rows("company_holiday") if row["id"] == holiday_id), None)
        if not existing:
            raise WorkflowError("Feriado nao encontrado.")
        holiday_date = payload.get("holiday_date", existing["holiday_date"])
        if not holiday_date:
            raise WorkflowError("Informe a data do feriado.")
        values = {"holiday_date": holiday_date, "description": payload.get("description", existing.get("description"))}
        if existing.get("company_id"):
            values["company_id"] = existing["company_id"]
        try:
            return self.supabase.update("company_holidays", {"id": f"eq.{holiday_id}"}, values)
        except Exception as error:
            if self._postgrest_error_code(error) != "PGRST205":
                raise
            return self._save_fallback_registry(user=user, entity_type="company_holiday", entity_id=holiday_id, action="company_holiday.updated", old_values=existing, new_values=values)

    def list_teams(self, user: CurrentUser) -> list[dict[str, Any]]:
        return self._list_named_registry("teams", "team")

    def create_team(self, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        return self._create_named_registry("teams", "team", user, payload)

    def update_team(self, team_id: str, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        return self._update_named_registry("teams", "team", team_id, user, payload)

    def delete_team(self, team_id: str, user: CurrentUser) -> None:
        self._delete_named_registry("teams", "team", team_id, user)

    def list_directorates(self, user: CurrentUser) -> list[dict[str, Any]]:
        return self._list_named_registry("directorates", "directorate")

    def create_directorate(self, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        return self._create_named_registry("directorates", "directorate", user, payload)

    def update_directorate(self, directorate_id: str, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        return self._update_named_registry("directorates", "directorate", directorate_id, user, payload)

    def delete_directorate(self, directorate_id: str, user: CurrentUser) -> None:
        self._delete_named_registry("directorates", "directorate", directorate_id, user)

    def preview_deadline(self, user: CurrentUser, payload: dict[str, Any]) -> dict[str, str]:
        self._require_activity_manager(user)
        if payload.get("deadline_days") in (None, ""):
            raise WorkflowError("Informe a quantidade de dias uteis.")
        base_value = payload.get("last_business_day")
        if payload.get("workflow_id"):
            workflow = self._require_workflow_access(str(payload["workflow_id"]), user)
            base_value = str(workflow.get("start_at") or "")[:10]
        if not base_value:
            base_value = str(payload.get("start_date") or "")[:10]
        if not base_value:
            raise WorkflowError("Informe o ultimo dia util considerado no workflow.")
        expected = self._deadline_from_workflow_base(date.fromisoformat(str(base_value)[:10]), int(payload["deadline_days"]))
        return {"expected_end_date": expected.isoformat()}

    def create_workflow(self, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_key_user(user)
        if payload.get("last_business_day") and not payload.get("start_date"):
            payload = {**payload, "start_date": payload["last_business_day"]}
        for field in ["name", "routine", "month", "year", "start_date", "expected_end_date"]:
            if not payload.get(field):
                raise WorkflowError(f"Campo obrigatorio ausente: {field}")
        workflow_name = str(payload["name"]).strip()
        if not workflow_name or not any(character.isalnum() for character in workflow_name):
            raise WorkflowError("Informe um nome valido para o workflow.")
        self._validate_routine(payload["routine"])

        workflow_payload, legacy_user = self._workflow_insert_payload(user, payload)
        workflow = self._insert_compatible("workflows", workflow_payload, {"is_active"})
        self.supabase.insert(
            "workflow_participants",
            {"workflow_id": workflow["id"], "user_id": legacy_user["id"], "access_level": "owner"},
        )
        self.audit.log(
            user=user,
            workflow_id=workflow["id"],
            action="workflow.created",
            entity_type="workflow",
            entity_id=workflow["id"],
            new_values=self._legacy_workflow_to_app(workflow),
        )
        return self._legacy_workflow_to_app(workflow)

    def list_users(self, user: CurrentUser) -> list[dict[str, Any]]:
        if not user.is_admin:
            return self._active_user_options()
        try:
            rows = self.supabase.select(
                "user_profiles",
                select="id,email,name,role,area,team_name,team_email,is_active,first_login_required",
                order="name.asc",
            )
        except Exception as error:
            if not self._is_missing_column_error(error):
                raise
            rows = self.supabase.select(
                "user_profiles",
                select="id,email,name,role,area,is_active,first_login_required",
                order="name.asc",
            )
            rows = [{**row, "team_name": None, "team_email": None} for row in rows]
        return self._enrich_users_from_auth(rows)

    def create_user(self, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_key_user(user)
        for field in ["email", "name", "role"]:
            if not payload.get(field):
                raise WorkflowError(f"Campo obrigatorio ausente: {field}")
        if payload["role"] not in {"consulta", "usuario", "usuario_chave", "admin", "user"}:
            raise WorkflowError("Role invalida.")

        try:
            auth_user = create_auth_user(
                payload["email"].strip().lower(),
                payload["name"].strip(),
                datetime.now(timezone.utc).strftime("Tmp#%fAxiom!"),
                operational_role=payload["role"],
                team_name=payload.get("team_name"),
                team_email=payload.get("team_email"),
            )
        except Exception as error:
            if getattr(getattr(error, "response", None), "status_code", None) == 422:
                raise WorkflowError("Já existe um usuário cadastrado com este e-mail.") from error
            raise
        profile_payload = {
                "id": auth_user["id"],
                "email": payload["email"].strip().lower(),
                "name": payload["name"].strip(),
                "role": payload["role"],
                "area": payload.get("area"),
                "team_name": payload.get("team_name"),
                "team_email": payload.get("team_email"),
                "is_active": bool(payload.get("is_active", True)),
                "first_login_required": True,
            }
        try:
            try:
                profile = self._insert_compatible("user_profiles", profile_payload, USER_TEAM_COLUMNS)
            except Exception as error:
                if self._postgrest_error_code(error) != "23514":
                    raise
                profile = self._insert_compatible(
                    "user_profiles",
                    {**profile_payload, "role": self._legacy_storage_role(payload["role"])},
                    USER_TEAM_COLUMNS,
                )
        except Exception:
            try:
                delete_auth_user(auth_user["id"])
            except Exception:
                pass
            raise
        profile = {
            **profile,
            "role": payload["role"],
            "team_name": payload.get("team_name"),
            "team_email": payload.get("team_email"),
        }
        self.audit.log(
            user=user,
            action="user.created",
            entity_type="user_profile",
            entity_id=profile["id"],
            new_values=profile,
        )
        return profile

    def update_user(self, current_user: CurrentUser, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_key_user(current_user)
        existing = self.supabase.get_one("user_profiles", filters={"id": f"eq.{user_id}"})
        if not existing:
            raise WorkflowError("Usuario nao encontrado.")
        try:
            current_metadata = list_auth_user_metadata().get(user_id, {})
        except Exception:
            current_metadata = {}
        role = self._operational_role(payload.get("role", current_metadata.get("operational_role") or existing["role"]))
        if role not in {"consulta", "usuario", "usuario_chave", "admin", "user"}:
            raise WorkflowError("Role invalida.")
        name = payload.get("name", existing["name"])
        email = str(payload.get("email", existing["email"])).strip().lower()
        if email != str(existing["email"]).strip().lower():
            email_owner = self.supabase.get_one("user_profiles", filters={"email": f"eq.{email}"})
            if email_owner and email_owner.get("id") != user_id:
                raise WorkflowError("Não foi possível atualizar: este e-mail já pertence a outro usuário.")
        team_name = payload.get("team_name", current_metadata.get("team_name") or existing.get("team_name"))
        team_email = payload.get("team_email", current_metadata.get("team_email") or existing.get("team_email"))
        update_payload = {
                "name": name,
                "email": email,
                "role": role,
                "area": payload.get("area", existing.get("area")),
                "team_name": team_name,
                "team_email": team_email,
                "is_active": payload.get("is_active", existing["is_active"]),
                "first_login_required": payload.get("first_login_required", existing["first_login_required"]),
            }
        try:
            update_auth_user_metadata(
                user_id,
                email=email,
                name=name,
                operational_role=role,
                team_name=team_name,
                team_email=team_email,
            )
        except Exception as error:
            if getattr(getattr(error, "response", None), "status_code", None) == 422:
                raise WorkflowError("Não foi possível atualizar: este e-mail já pertence a outro usuário.") from error
            raise
        try:
            updated = self._update_compatible("user_profiles", {"id": f"eq.{user_id}"}, update_payload, USER_TEAM_COLUMNS)
        except Exception as error:
            if self._postgrest_error_code(error) != "23514":
                raise
            updated = self._update_compatible(
                "user_profiles",
                {"id": f"eq.{user_id}"},
                {**update_payload, "role": self._legacy_storage_role(role)},
                USER_TEAM_COLUMNS,
            )
        updated = {**updated, "role": role, "team_name": team_name, "team_email": team_email}
        self.audit.log(
            user=current_user,
            action="user.updated",
            entity_type="user_profile",
            entity_id=user_id,
            old_values=existing,
            new_values=updated,
        )
        return updated

    def list_stage_settings(self, user: CurrentUser) -> list[dict[str, Any]]:
        self._require_admin(user)
        return self.supabase.select("stage_responsibility_settings", order="stage_name.asc")

    def upsert_stage_setting(self, user: CurrentUser, stage_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_admin(user)
        self._validate_stage(stage_name)
        existing = self.supabase.get_one(
            "stage_responsibility_settings",
            filters={"stage_name": f"eq.{stage_name}"},
        )
        data = {
            "stage_name": stage_name,
            "default_responsible_user_id": payload.get("default_responsible_user_id") or None,
            "default_backup_user_id": payload.get("default_backup_user_id") or None,
            "updated_by": user.id,
            "updated_at": self._now_iso(),
        }
        updated = (
            self.supabase.update("stage_responsibility_settings", {"id": f"eq.{existing['id']}"}, data)
            if existing
            else self.supabase.insert("stage_responsibility_settings", data)
        )
        self.audit.log(
            user=user,
            action="stage_setting.updated",
            entity_type="stage_responsibility_settings",
            entity_id=updated["id"],
            old_values=existing,
            new_values=updated,
        )
        return updated

    def list_templates(self, user: CurrentUser) -> list[dict[str, Any]]:
        templates = self.supabase.select("activity_templates", order="name.asc")
        template_ids = [row["id"] for row in templates]
        dependencies = self.supabase.select(
            "activity_template_dependencies",
            filters={"activity_template_id": self._in_filter(template_ids)} if template_ids else self._empty_uuid_filter("activity_template_id"),
        )
        dep_map: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for dependency in dependencies:
            dep_map[dependency["activity_template_id"]].append(dependency)
        return [{**template, "dependencies": dep_map.get(template["id"], [])} for template in templates]

    def create_template(self, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_activity_manager(user)
        for field in ["name", "stage", "routine"]:
            if not payload.get(field):
                raise WorkflowError(f"Campo obrigatorio ausente: {field}")
        self._validate_stage(payload["stage"])
        self._validate_routine(payload["routine"])
        defaults = self._stage_defaults(payload["stage"])
        start_date = payload.get("start_date") or self._today().isoformat()
        deadline_type = payload.get("deadline_type", "fixed_date")
        if deadline_type == "business_days":
            if payload.get("deadline_days") in (None, ""):
                raise WorkflowError("Informe a quantidade de dias uteis para o prazo.")
            expected_end_date = self._deadline_from_month_close(
                date.fromisoformat(str(start_date)[:10]), int(payload["deadline_days"]), payload.get("company")
            ).isoformat()
        else:
            expected_end_date = payload.get("expected_end_date") or start_date
            self._validate_date_range(start_date, expected_end_date)
            if not self._is_business_day(date.fromisoformat(str(expected_end_date)[:10]), payload.get("company")):
                raise WorkflowError("A data fixa cai em fim de semana ou feriado. Ajuste a data manualmente.")
        template = self._insert_compatible(
            "activity_templates",
            {
                "name": payload["name"].strip(),
                "stage": payload["stage"],
                "routine": payload["routine"],
                "responsible_user_id": payload.get("responsible_user_id") or defaults.get("default_responsible_user_id"),
                "responsible_backup_user_id": payload.get("responsible_backup_user_id") or defaults.get("default_backup_user_id"),
                "requires_attachment": bool(payload.get("requires_attachment", False)),
                "requires_approval": bool(payload.get("requires_approval", False)),
                "approver_user_id": payload.get("approver_user_id"),
                "start_date": start_date,
                "expected_end_date": expected_end_date,
                "company": payload.get("company"),
                "deadline_type": deadline_type,
                "deadline_days": payload.get("deadline_days") or None,
                "notify_team": bool(payload.get("notify_team", False)),
                "team_email_snapshot": payload.get("team_email") or None,
                "created_by": user.id,
            },
            TEMPLATE_OPERATIONAL_COLUMNS,
        )
        dependency_ids = payload.get("dependency_template_ids") or []
        self._validate_template_dependencies(template["id"], dependency_ids)
        if dependency_ids:
            self.supabase.bulk_insert(
                "activity_template_dependencies",
                [
                    {
                        "activity_template_id": template["id"],
                        "depends_on_template_id": dependency_id,
                    }
                    for dependency_id in dependency_ids
                ],
            )
        self.audit.log(
            user=user,
            action="activity_template.created",
            entity_type="activity_template",
            entity_id=template["id"],
            new_values=template,
        )
        return template

    def update_template(self, user: CurrentUser, template_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        existing = self.supabase.get_one("activity_templates", filters={"id": f"eq.{template_id}"})
        if not existing:
            raise WorkflowError("Template nao encontrado.")
        stage = payload.get("stage", existing["stage"])
        routine = payload.get("routine", existing["routine"])
        self._validate_stage(stage)
        self._validate_routine(routine)
        start_date = payload.get("start_date", existing.get("start_date") or self._today().isoformat())
        expected_end_date = payload.get("expected_end_date", existing.get("expected_end_date") or start_date)
        self._validate_date_range(start_date, expected_end_date)
        updated = self.supabase.update(
            "activity_templates",
            {"id": f"eq.{template_id}"},
            {
                "name": payload.get("name", existing["name"]),
                "stage": stage,
                "routine": routine,
                "responsible_user_id": payload.get("responsible_user_id", existing.get("responsible_user_id")),
                "responsible_backup_user_id": payload.get("responsible_backup_user_id", existing.get("responsible_backup_user_id")),
                "requires_attachment": payload.get("requires_attachment", existing["requires_attachment"]),
                "requires_approval": payload.get("requires_approval", existing["requires_approval"]),
                "approver_user_id": payload.get("approver_user_id", existing.get("approver_user_id")),
                "start_date": start_date,
                "expected_end_date": expected_end_date,
                "company": payload.get("company", existing.get("company")),
            },
        )
        if "dependency_template_ids" in payload:
            dependency_ids = payload.get("dependency_template_ids") or []
            self._validate_template_dependencies(template_id, dependency_ids)
            self.supabase.delete("activity_template_dependencies", {"activity_template_id": f"eq.{template_id}"})
            if dependency_ids:
                self.supabase.bulk_insert(
                    "activity_template_dependencies",
                    [
                        {
                            "activity_template_id": template_id,
                            "depends_on_template_id": dependency_id,
                        }
                        for dependency_id in dependency_ids
                    ],
                )
        self.audit.log(
            user=user,
            action="activity_template.updated",
            entity_type="activity_template",
            entity_id=template_id,
            old_values=existing,
            new_values=updated,
        )
        return updated

    def list_workflow_activities(self, workflow_id: str, user: CurrentUser) -> list[dict[str, Any]]:
        self._require_workflow_access(workflow_id, user)
        self._recompute_activity_statuses(workflow_id, user)
        self._send_due_reminders(workflow_id, user)
        activities = self.supabase.select(
            "workflow_activities",
            filters={"workflow_id": f"eq.{workflow_id}"},
            order="expected_end_date.asc",
        )
        activities = self._enrich_activity_rules(activities)
        activity_ids = [activity["id"] for activity in activities]
        dependency_map = self._dependency_map(activity_ids)
        attachment_map = self._attachment_map(activity_ids)
        profile_ids = {
            value
            for activity in activities
            for value in (
                activity.get("responsible_user_id"),
                activity.get("responsible_backup_user_id"),
                activity.get("approver_user_id"),
                activity.get("completed_by"),
                activity.get("rejected_by"),
            )
            if value
        }
        profiles_by_id = self._profile_map(profile_ids)
        return [
            self._serialize_activity(
                activity,
                dependencies=dependency_map.get(activity["id"], []),
                attachments=attachment_map.get(activity["id"], []),
                profiles_by_id=profiles_by_id,
            )
            for activity in activities
        ]

    def list_all_activities(self, user: CurrentUser) -> list[dict[str, Any]]:
        workflow_ids = self._list_accessible_workflow_ids(user)
        if not workflow_ids:
            return []
        activities = self.supabase.select(
            "workflow_activities",
            filters={"workflow_id": self._in_filter(workflow_ids)},
            order="expected_end_date.asc",
        )
        activities = self._enrich_activity_rules(activities)
        activity_ids = [activity["id"] for activity in activities]
        dependency_map = self._dependency_map(activity_ids)
        attachment_map = self._attachment_map(activity_ids)
        profile_ids = {
            value
            for activity in activities
            for value in (
                activity.get("responsible_user_id"),
                activity.get("responsible_backup_user_id"),
                activity.get("approver_user_id"),
                activity.get("completed_by"),
                activity.get("rejected_by"),
            )
            if value
        }
        profiles_by_id = self._profile_map(profile_ids)
        return [
            self._serialize_activity(
                activity,
                dependencies=dependency_map.get(activity["id"], []),
                attachments=attachment_map.get(activity["id"], []),
                profiles_by_id=profiles_by_id,
            )
            for activity in activities
        ]

    def create_workflow_activity(self, workflow_id: str, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_activity_manager(user)
        workflow = self._require_workflow_access(workflow_id, user, write=True)
        for field in ["name", "stage", "routine"]:
            if not payload.get(field):
                raise WorkflowError(f"Campo obrigatorio ausente: {field}")
        if payload.get("deadline_type", "fixed_date") == "fixed_date" and not payload.get("expected_end_date"):
            raise WorkflowError("Campo obrigatorio ausente: expected_end_date")
        self._validate_stage(payload["stage"])
        self._validate_routine(payload["routine"])
        # start_date é mantida internamente apenas por compatibilidade com a
        # base legada; não é mais um dado solicitado nem usado na execução.
        payload = {**payload, "start_date": payload.get("start_date") or str(workflow.get("start_at") or self._today().isoformat())[:10]}
        template = self.create_template(user, payload | {"dependency_template_ids": []})
        activity = self._insert_compatible(
            "workflow_activities",
            self._build_activity_snapshot(workflow_id, template, payload),
            ACTIVITY_OPERATIONAL_COLUMNS,
        )
        self._save_activity_rule({**payload, **activity}, user)
        dependency_ids = payload.get("dependency_activity_ids") or []
        self._replace_workflow_activity_dependencies(
            workflow_id=workflow_id,
            activity_id=activity["id"],
            dependency_ids=dependency_ids,
            user=user,
        )
        self.audit.log(
            user=user,
            workflow_id=workflow_id,
            action="workflow_activity.created",
            entity_type="workflow_activity",
            entity_id=activity["id"],
            new_values=activity,
        )
        self._recompute_activity_statuses(workflow_id, user)
        return self.supabase.get_one("workflow_activities", filters={"id": f"eq.{activity['id']}"}) or activity

    def link_templates_to_workflow(self, workflow_id: str, user: CurrentUser, template_ids: list[str]) -> list[dict[str, Any]]:
        self._require_workflow_access(workflow_id, user, write=True)
        if not template_ids:
            raise WorkflowError("Nenhum template informado para vinculo.")
        templates = self.supabase.select("activity_templates", filters={"id": self._in_filter(template_ids)})
        if len(templates) != len(template_ids):
            raise WorkflowError("Um ou mais templates nao foram encontrados.")

        existing_instances = self.supabase.select(
            "workflow_activities",
            filters={"workflow_id": f"eq.{workflow_id}"},
        )
        existing_by_template_id = {
            item["activity_template_id"]: item
            for item in existing_instances
            if item.get("activity_template_id")
        }

        created_instances: list[dict[str, Any]] = []
        for template in templates:
            if template["id"] in existing_by_template_id:
                continue
            created_instances.append(
                self._insert_compatible(
                    "workflow_activities",
                    self._build_activity_snapshot(workflow_id, template, {}),
                    ACTIVITY_OPERATIONAL_COLUMNS,
                )
            )
        if not created_instances:
            raise WorkflowError("Todos os templates selecionados ja estao vinculados a este workflow.")

        merged_by_template_id = {
            **existing_by_template_id,
            **{
                instance["activity_template_id"]: instance
                for instance in created_instances
                if instance.get("activity_template_id")
            },
        }
        dependency_rows = self.supabase.select(
            "activity_template_dependencies",
            filters={"activity_template_id": self._in_filter([row["id"] for row in templates])},
        )
        for instance in created_instances:
            template_dependency_ids = [
                merged_by_template_id[row["depends_on_template_id"]]["id"]
                for row in dependency_rows
                if row["activity_template_id"] == instance.get("activity_template_id")
                and row["depends_on_template_id"] in merged_by_template_id
            ]
            self._replace_workflow_activity_dependencies(
                workflow_id=workflow_id,
                activity_id=instance["id"],
                dependency_ids=template_dependency_ids,
                user=user,
            )
            self.audit.log(
                user=user,
                workflow_id=workflow_id,
                action="workflow_activity.linked",
                entity_type="workflow_activity",
                entity_id=instance["id"],
                details={"template_id": instance.get("activity_template_id")},
            )
        self._recompute_activity_statuses(workflow_id, user)
        return self.list_workflow_activities(workflow_id, user)

    def update_workflow_activity(self, activity_id: str, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_activity_manager(user)
        current = self._require_activity_access(activity_id, user, write=True)
        current = self._enrich_activity_rules([current])[0]
        stage = payload.get("stage_snapshot", current["stage_snapshot"])
        routine = payload.get("routine_snapshot", current["routine_snapshot"])
        start_date = payload.get("start_date", current["start_date"])
        deadline_type = payload.get("deadline_type", current.get("deadline_type", "fixed_date"))
        deadline_days = payload.get("deadline_days", current.get("deadline_days"))
        company_snapshot = payload.get("company_snapshot", current.get("company_snapshot"))
        if deadline_type == "business_days":
            if deadline_days is None:
                raise WorkflowError("Informe a quantidade de dias uteis para o prazo.")
            workflow = self._require_workflow_access(current["workflow_id"], user)
            base_value = str(workflow.get("start_at") or start_date)[:10]
            expected_end_date = self._deadline_from_workflow_base(date.fromisoformat(base_value), int(deadline_days)).isoformat()
        else:
            expected_end_date = payload.get("expected_end_date", current["expected_end_date"])
        self._validate_stage(stage)
        self._validate_routine(routine)
        if deadline_type != "business_days":
            self._validate_date_range(start_date, expected_end_date)
            if not self._is_business_day(date.fromisoformat(str(expected_end_date)[:10]), company_snapshot):
                raise WorkflowError("A data fixa cai em fim de semana ou feriado. Ajuste a data manualmente.")
        updated = self._update_compatible(
            "workflow_activities",
            {"id": f"eq.{activity_id}"},
            {
                "name_snapshot": payload.get("name_snapshot", current["name_snapshot"]),
                "stage_snapshot": stage,
                "routine_snapshot": routine,
                "responsible_user_id": payload.get("responsible_user_id", current.get("responsible_user_id")),
                "responsible_backup_user_id": payload.get("responsible_backup_user_id", current.get("responsible_backup_user_id")),
                "requires_attachment_snapshot": payload.get("requires_attachment_snapshot", current["requires_attachment_snapshot"]),
                "requires_approval_snapshot": payload.get("requires_approval_snapshot", current["requires_approval_snapshot"]),
                "approver_user_id": payload.get("approver_user_id", current.get("approver_user_id")),
                "start_date": start_date,
                "expected_end_date": expected_end_date,
                "company_snapshot": company_snapshot,
                "deadline_type": deadline_type,
                "deadline_days": int(deadline_days) if deadline_days is not None else None,
                "notify_team": bool(payload.get("notify_team", current.get("notify_team", False))),
                "team_email_snapshot": payload.get("team_email", current.get("team_email_snapshot")),
            },
            ACTIVITY_OPERATIONAL_COLUMNS,
        )
        self._save_activity_rule({**current, **payload, **updated, "deadline_type": deadline_type, "deadline_days": deadline_days}, user)
        if "dependency_activity_ids" in payload:
            self._replace_workflow_activity_dependencies(
                workflow_id=current["workflow_id"],
                activity_id=activity_id,
                dependency_ids=payload.get("dependency_activity_ids") or [],
                user=user,
            )
        self.audit.log(
            user=user,
            workflow_id=current["workflow_id"],
            action="workflow_activity.updated",
            entity_type="workflow_activity",
            entity_id=activity_id,
            old_values=current,
            new_values=updated,
        )
        self._recompute_activity_statuses(current["workflow_id"], user)
        return updated

    def _validate_completion(self, activity: dict[str, Any], action: str, *, has_attachment: bool = False) -> None:
        if activity["status"] == "Bloqueada":
            raise WorkflowError("Atividade bloqueada por dependencias.")
        if action in {"complete", "submit_for_approval"} and activity["requires_attachment_snapshot"]:
            if has_attachment:
                return
            attachments = self.supabase.select(
                "workflow_activity_attachments",
                filters={"workflow_activity_id": f"eq.{activity['id']}"},
            )
            if not attachments:
                raise WorkflowError("Esta atividade exige anexo antes da conclusao.")

    def act_on_activity(
        self,
        activity_id: str,
        user: CurrentUser,
        payload: dict[str, Any],
        *,
        has_attachment: bool = False,
    ) -> dict[str, Any]:
        action = payload.get("action")
        if action not in {"complete", "submit_for_approval", "approve", "reject"}:
            raise WorkflowError("Acao invalida para atividade.")

        activity = self._require_activity_access(activity_id, user)
        self._recompute_activity_statuses(activity["workflow_id"], user)
        activity = self._require_activity_access(activity_id, user)
        if action in {"complete", "submit_for_approval"} and user.id not in {activity.get("responsible_user_id"), activity.get("responsible_backup_user_id")} and not user.is_admin:
            raise WorkflowError("Somente o responsavel pode executar esta acao.")
        if action in {"approve", "reject"} and activity.get("approver_user_id") != user.id and not user.is_admin:
            raise WorkflowError("Somente o aprovador pode executar esta acao.")
        if action in {"approve", "reject"} and activity.get("status") != "Pendente de aprovacao":
            raise WorkflowError("A atividade nao esta pendente de aprovacao.")
        if action in {"complete", "submit_for_approval"} and activity.get("status") in {"Pendente de aprovacao", "Concluida", "Reprovada"}:
            raise WorkflowError("A atividade nao esta disponivel para conclusao.")
        if action == "complete" and activity["requires_approval_snapshot"]:
            raise WorkflowError("Esta atividade deve ser enviada para aprovacao.")
        if action == "submit_for_approval" and not activity["requires_approval_snapshot"]:
            raise WorkflowError("Esta atividade nao exige aprovacao.")
        if action == "reject" and not str(payload.get("notes") or "").strip():
            raise WorkflowError("Informe o motivo da reprovacao.")
        self._validate_completion(activity, action, has_attachment=has_attachment)

        now = self._now_iso()
        if action == "complete":
            update_payload = {
                "status": "Concluida",
                "approval_status": "Nao aplicavel",
                "completed_at": now,
                "completed_by": user.id,
            }
        elif action == "submit_for_approval":
            update_payload = {
                "status": "Pendente de aprovacao",
                "approval_status": "Pendente",
                "rejected_at": None,
                "rejected_by": None,
                "approval_notification_sent_at": None,
                "rejection_notification_sent_at": None,
            }
        elif action == "approve":
            update_payload = {
                "status": "Concluida",
                "approval_status": "Aprovada",
                "completed_at": now,
                "completed_by": user.id,
            }
        else:
            update_payload = {
                "status": "Nao iniciada",
                "approval_status": "Reprovada",
                "rejected_at": now,
                "rejected_by": user.id,
            }

        updated = self._update_compatible(
            "workflow_activities",
            {"id": f"eq.{activity_id}"},
            update_payload,
            ACTIVITY_OPERATIONAL_COLUMNS,
        )
        notification_sent: bool | None = None
        if action == "submit_for_approval" and not activity.get("approval_notification_sent_at"):
            notification_sent = self._send_activity_notification(
                updated,
                "Atividade disponivel para sua aprovacao",
                f"Prezado(a), a atividade '{updated['name_snapshot']}' esta disponivel para sua aprovacao. Fique atento ao seu prazo de conclusao {updated['expected_end_date']}.",
                roles=("approver",),
                include_team=False,
                user=user,
            )
            if notification_sent:
                self._mark_notification_sent(activity_id, "approval_notification_sent_at", now)
        if action == "reject" and not activity.get("rejection_notification_sent_at"):
            rejection_reason = str(payload.get("notes") or "Nao informado")
            notification_sent = self._send_activity_notification(
                updated,
                "Atividade reprovada",
                f"Prezado(a), a atividade '{updated['name_snapshot']}' foi reprovada pelo motivo: {rejection_reason}. Realize os ajustes necessarios e reenvie para aprovacao.",
                roles=("responsible",),
                include_team=False,
                user=user,
            )
            if notification_sent:
                self._mark_notification_sent(activity_id, "rejection_notification_sent_at", now)
        self.audit.log(
            user=user,
            workflow_id=activity["workflow_id"],
            action=f"workflow_activity.{action}",
            entity_type="workflow_activity",
            entity_id=activity_id,
            details={"notes": payload.get("notes")},
            old_values={"status": activity["status"], "approval_status": activity["approval_status"]},
            new_values={"status": updated["status"], "approval_status": updated["approval_status"]},
        )
        self._recompute_activity_statuses(activity["workflow_id"], user)
        if updated["status"] == "Concluida":
            self._notify_next_activity_by_date(updated, user)
        if notification_sent is not None:
            updated["notification_sent"] = notification_sent
        return updated

    def upload_attachment(self, activity_id: str, user: CurrentUser, file: Any) -> dict[str, Any]:
        activity = self._require_activity_access(activity_id, user, write=True)
        routing = self._send_attachment_email(activity, user, file)
        self.audit.log(
            user=user,
            workflow_id=activity["workflow_id"],
            action="workflow_activity.attachment_emailed",
            entity_type="workflow_activity",
            entity_id=activity_id,
            details={"file_name": file.filename, **routing},
        )
        return {"file_name": file.filename, "sent": True}

    def _send_attachment_email(self, activity: dict[str, Any], user: CurrentUser, file: Any) -> dict[str, str]:
        email_service = EmailService()
        if not email_service.attachment_to:
            raise WorkflowError("O recebimento de anexos por e-mail ainda não está configurado. Fale com o administrador do sistema.")
        content = file.read()
        if not content:
            raise WorkflowError("O arquivo enviado esta vazio.")
        workflow = self.supabase.get_one("workflows", filters={"id": f"eq.{activity['workflow_id']}"}) or {}
        workflow_data = self._legacy_workflow_to_app(workflow) if workflow else {}
        period = ""
        if workflow_data.get("year") and workflow_data.get("month"):
            period = f"{int(workflow_data['year']):04d}-{int(workflow_data['month']):02d}"

        def metadata_value(value: Any) -> str:
            return str(value or "").replace("\r", " ").replace("\n", " ").strip()

        routing = {
            "recipient": email_service.attachment_to,
            "submission_id": str(uuid4()),
            "workflow_id": str(activity["workflow_id"]),
            "activity_id": str(activity["id"]),
            "period": period,
            "company": metadata_value(activity.get("company_snapshot")),
        }
        subject = (
            f"CHAVE|ENVIO={routing['submission_id']}|WORKFLOW={routing['workflow_id']}|"
            f"ATIVIDADE={routing['activity_id']}|PERIODO={period or 'NA'}"
        )
        text = "\n".join(
            [
                "CHAVE=AXIOM_ATTACHMENT",
                "VERSAO=1",
                f"ENVIO_ID={routing['submission_id']}",
                f"WORKFLOW_ID={routing['workflow_id']}",
                f"WORKFLOW_NOME={metadata_value(workflow_data.get('name'))}",
                f"ATIVIDADE_ID={routing['activity_id']}",
                f"ATIVIDADE_NOME={metadata_value(activity.get('name_snapshot'))}",
                f"EMPRESA={routing['company']}",
                f"PERIODO={period}",
                f"ARQUIVO_NOME={metadata_value(file.filename or 'anexo.bin')}",
                f"ENVIADO_POR={metadata_value(user.email)}",
            ]
        )
        try:
            email_service.send_email(
                to_email=email_service.attachment_to,
                subject=subject,
                text=text,
                attachments=[(file.filename or "anexo.bin", content, file.mimetype or "application/octet-stream")],
                use_redirect=False,
            )
        except Exception as error:
            raise WorkflowError("Não foi possível enviar o anexo para o e-mail de integração. Verifique a configuração do serviço de e-mail.") from error
        return routing

    def complete_activity_with_attachment(self, activity_id: str, user: CurrentUser, file: Any | None) -> dict[str, Any]:
        activity = self._require_activity_access(activity_id, user)
        if user.id not in {activity.get("responsible_user_id"), activity.get("responsible_backup_user_id")} and not user.is_admin:
            raise WorkflowError("Somente o responsavel pode concluir esta atividade.")
        self._recompute_activity_statuses(activity["workflow_id"], user)
        activity = self._require_activity_access(activity_id, user)
        self._validate_completion(activity, "complete", has_attachment=file is not None)
        if file is not None:
            routing = self._send_attachment_email(activity, user, file)
            self.audit.log(
                user=user,
                workflow_id=activity["workflow_id"],
                action="workflow_activity.attachment_emailed",
                entity_type="workflow_activity",
                entity_id=activity_id,
                details={"file_name": file.filename, **routing},
            )
        action = "submit_for_approval" if activity["requires_approval_snapshot"] else "complete"
        return self.act_on_activity(activity_id, user, {"action": action}, has_attachment=file is not None)

    def list_logs(self, user: CurrentUser, workflow_id: str | None = None) -> list[dict[str, Any]]:
        filters = None
        if workflow_id:
            self._require_workflow_access(workflow_id, user)
            filters = {"workflow_id": f"eq.{workflow_id}"}
        rows = self.supabase.select("audit_logs", filters=filters, order="created_at.desc")
        profiles_by_id = self._profile_map({row["user_id"] for row in rows if row.get("user_id")})
        return [{**row, "actor_user": profiles_by_id.get(row.get("user_id"))} for row in rows]
