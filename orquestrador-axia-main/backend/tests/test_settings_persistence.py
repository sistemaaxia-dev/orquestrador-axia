from __future__ import annotations

import unittest
from collections import defaultdict
from unittest.mock import MagicMock, patch

from backend.app.services.auth_service import CurrentUser
from backend.app.services.workflow_service import WorkflowService


def missing_table_error() -> Exception:
    response = MagicMock()
    response.json.return_value = {"code": "PGRST205", "message": "table not found"}
    error = RuntimeError("404 Not Found")
    error.response = response
    return error


class MemorySupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = defaultdict(list)
        self.sequence = 0

    def _matches(self, row: dict, filters: dict[str, str] | None) -> bool:
        if not filters:
            return True
        for key, expression in filters.items():
            if expression.startswith("eq.") and str(row.get(key)) != expression.removeprefix("eq."):
                return False
        return True

    def select(self, resource: str, *, filters=None, order=None, **_kwargs):
        rows = [dict(row) for row in self.tables[resource] if self._matches(row, filters)]
        if order:
            key, _, direction = order.partition(".")
            rows.sort(key=lambda row: str(row.get(key) or ""), reverse=direction == "desc")
        return rows

    def get_one(self, resource: str, *, filters=None, **_kwargs):
        rows = self.select(resource, filters=filters)
        return rows[0] if rows else None

    def insert(self, resource: str, payload: dict, **_kwargs):
        self.sequence += 1
        row = {"id": payload.get("id") or f"row-{self.sequence}", **payload}
        self.tables[resource].append(row)
        return dict(row)

    def update(self, resource: str, filters: dict[str, str], payload: dict, **_kwargs):
        for row in self.tables[resource]:
            if self._matches(row, filters):
                row.update(payload)
                return dict(row)
        return {}

    def delete(self, resource: str, filters: dict[str, str], **_kwargs):
        deleted = [dict(row) for row in self.tables[resource] if self._matches(row, filters)]
        self.tables[resource] = [row for row in self.tables[resource] if not self._matches(row, filters)]
        return deleted


def admin_user() -> CurrentUser:
    return CurrentUser(
        id="admin-1",
        email="admin@example.com",
        name="Administrador",
        role="usuario_chave",
        is_admin=True,
        first_login_required=False,
        is_active=True,
    )


class SettingsPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.database = MemorySupabase()
        self.service = object.__new__(WorkflowService)
        self.service.supabase = self.database
        self.service.audit = MagicMock()
        self.user = admin_user()

    def test_company_create_edit_and_activation_persist(self):
        created = self.service.create_company(self.user, {"name": "Empresa Bahia"})
        renamed = self.service.update_company(created["id"], self.user, {"name": "Empresa Salvador"})
        inactive = self.service.update_company(created["id"], self.user, {"is_active": False})

        self.assertEqual(renamed["name"], "Empresa Salvador")
        self.assertFalse(inactive["is_active"])
        self.assertEqual(self.service.list_companies(self.user)[0]["name"], "Empresa Salvador")

    def test_holiday_create_edit_and_delete_persist(self):
        company = self.service.create_company(self.user, {"name": "Empresa Feira"})
        holiday = self.service.create_holiday(company["id"], self.user, {"holiday_date": "2026-09-07", "description": "Independencia"})
        updated = self.service.update_holiday(holiday["id"], self.user, {"description": "Independencia do Brasil"})

        self.assertEqual(updated["description"], "Independencia do Brasil")
        self.assertEqual(len(self.service.list_holidays(company["id"], self.user)), 1)

        self.service.delete_holiday(holiday["id"], self.user)
        self.assertEqual(self.service.list_holidays(company["id"], self.user), [])

    def test_stage_responsibilities_insert_and_update_persist(self):
        created = self.service.upsert_stage_setting(
            self.user,
            "Apuracao",
            {"default_responsible_user_id": "user-1", "default_backup_user_id": "user-2"},
        )
        updated = self.service.upsert_stage_setting(
            self.user,
            "Apuracao",
            {"default_responsible_user_id": "user-3", "default_backup_user_id": None},
        )

        self.assertEqual(created["default_responsible_user_id"], "user-1")
        self.assertEqual(updated["default_responsible_user_id"], "user-3")
        self.assertIsNone(updated["default_backup_user_id"])
        self.assertEqual(len(self.database.tables["stage_responsibility_settings"]), 1)

    @patch("backend.app.services.workflow_service.update_auth_user_metadata")
    @patch("backend.app.services.workflow_service.list_auth_user_metadata", return_value={})
    @patch("backend.app.services.workflow_service.create_auth_user", return_value={"id": "user-10"})
    def test_user_create_edit_team_and_activation_persist(self, _create_auth_user, _list_metadata, update_metadata):
        created = self.service.create_user(
            self.user,
            {"email": "responsavel@example.com", "name": "Responsavel", "role": "usuario", "team_name": "Fiscal", "team_email": "fiscal@example.com"},
        )
        updated = self.service.update_user(
            self.user,
            created["id"],
            {"team_name": "Contabil", "team_email": "contabil@example.com", "is_active": False},
        )

        self.assertEqual(updated["team_name"], "Contabil")
        self.assertEqual(updated["team_email"], "contabil@example.com")
        self.assertFalse(updated["is_active"])
        update_metadata.assert_called_once()

    def test_user_listing_falls_back_for_postgres_missing_column_code(self):
        response = MagicMock()
        response.json.return_value = {
            "code": "42703",
            "message": "column user_profiles.team_name does not exist",
        }
        missing_column = RuntimeError("400 Bad Request")
        missing_column.response = response
        legacy_user = {
            "id": "user-1",
            "email": "user@example.com",
            "name": "Usuario",
            "role": "usuario",
            "area": None,
            "is_active": True,
            "first_login_required": False,
        }
        database = MagicMock()
        database.select.side_effect = [missing_column, [legacy_user]]
        self.service.supabase = database

        users = self.service.list_users(self.user)

        self.assertIsNone(users[0]["team_name"])
        self.assertIsNone(users[0]["team_email"])
        self.assertEqual(users[0]["role"], "usuario")
        self.assertEqual(database.select.call_count, 2)

    def test_company_and_directory_lists_persist_when_new_tables_are_not_migrated(self):
        events: list[dict] = []
        database = MagicMock()

        def select(resource, **kwargs):
            if resource == "audit_logs":
                entity_type = (kwargs.get("filters") or {}).get("entity_type", "").removeprefix("eq.")
                return [event for event in events if event["entity_type"] == entity_type]
            raise missing_table_error()

        def insert(_resource, _payload, **_kwargs):
            raise missing_table_error()

        def record(**kwargs):
            events.append({**kwargs, "created_at": f"2026-08-25T00:00:{len(events):02d}Z"})
            return events[-1]

        database.select.side_effect = select
        database.insert.side_effect = insert
        database.update.side_effect = missing_table_error()
        database.delete.side_effect = missing_table_error()
        self.service.supabase = database
        self.service.audit.log.side_effect = record

        company = self.service.create_company(self.user, {"name": "Empresa Axia"})
        team = self.service.create_team(self.user, {"name": "Fiscal", "email": "fiscal@axia.com"})
        directorate = self.service.create_directorate(self.user, {"name": "Controladoria"})
        renamed = self.service.update_company(company["id"], self.user, {"name": "Empresa Axia Brasil"})

        self.assertEqual(renamed["name"], "Empresa Axia Brasil")
        self.assertEqual(self.service.list_companies(self.user)[0]["name"], "Empresa Axia Brasil")
        self.assertEqual(self.service.list_teams(self.user)[0]["email"], "fiscal@axia.com")
        self.assertEqual(self.service.list_directorates(self.user)[0]["id"], directorate["id"])
        self.service.delete_team(team["id"], self.user)
        self.assertEqual(self.service.list_teams(self.user), [])


if __name__ == "__main__":
    unittest.main()
