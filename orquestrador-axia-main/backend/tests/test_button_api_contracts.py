from __future__ import annotations

import unittest
from contextlib import ExitStack
from unittest.mock import MagicMock, patch

from backend.app import create_app
from backend.tests.test_settings_persistence import admin_user


class ButtonApiContractTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config.update(TESTING=True)
        self.client = self.app.test_client()
        self.service = MagicMock()
        self.service.create_workflow.return_value = {"id": "workflow-1"}
        self.service.update_workflow.return_value = {"id": "workflow-1"}
        self.service.duplicate_workflow.return_value = {"id": "workflow-2"}
        self.service.create_workflow_activity.return_value = {"id": "activity-1"}
        self.service.link_templates_to_workflow.return_value = [{"id": "activity-1"}]
        self.service.create_template.return_value = {"id": "template-1"}
        self.service.update_template.return_value = {"id": "template-1"}
        self.service.update_workflow_activity.return_value = {"id": "activity-1"}
        self.service.act_on_activity.return_value = {"id": "activity-1", "status": "Concluida"}
        self.service.complete_activity_with_attachment.return_value = {"id": "activity-1", "status": "Concluida"}
        self.service.create_user.return_value = {"id": "user-1"}
        self.service.update_user.return_value = {"id": "user-1"}
        self.service.create_company.return_value = {"id": "company-1"}
        self.service.update_company.return_value = {"id": "company-1"}
        self.service.create_holiday.return_value = {"id": "holiday-1"}
        self.service.update_holiday.return_value = {"id": "holiday-1"}
        self.service.upsert_stage_setting.return_value = {"id": "stage-1"}

    def test_every_save_action_has_a_working_api_contract(self):
        route_modules = ("workflows", "activities", "users", "settings")
        cases = [
            ("POST", "/api/workflows", {"name": "WF"}, 201),
            ("PATCH", "/api/workflows/workflow-1", {"is_active": False}, 200),
            ("POST", "/api/workflows/workflow-1/duplicate", None, 201),
            ("POST", "/api/workflows/workflow-1/activities", {"name": "Atividade"}, 201),
            ("POST", "/api/workflows/workflow-1/activity-links", {"template_ids": ["template-1"]}, 200),
            ("POST", "/api/activity-templates", {"name": "Template"}, 201),
            ("PATCH", "/api/activity-templates/template-1", {"name": "Template editado"}, 200),
            ("PATCH", "/api/workflow-activities/activity-1", {"name_snapshot": "Editada"}, 200),
            ("DELETE", "/api/workflow-activities/activity-1", None, 200),
            ("POST", "/api/workflow-activities/activity-1/actions", {"action": "approve"}, 200),
            ("POST", "/api/workflow-activities/activity-1/complete", None, 200),
            ("POST", "/api/users", {"name": "Usuario"}, 201),
            ("PATCH", "/api/users/user-1", {"is_active": False}, 200),
            ("POST", "/api/settings/companies", {"name": "Empresa"}, 201),
            ("PATCH", "/api/settings/companies/company-1", {"name": "Empresa editada"}, 200),
            ("POST", "/api/settings/companies/company-1/holidays", {"holiday_date": "2026-09-07"}, 201),
            ("PATCH", "/api/settings/holidays/holiday-1", {"description": "Editado"}, 200),
            ("DELETE", "/api/settings/holidays/holiday-1", None, 200),
            ("PUT", "/api/settings/stages/Apuracao", {"default_responsible_user_id": "user-1"}, 200),
        ]

        with ExitStack() as stack:
            for module in route_modules:
                stack.enter_context(patch(f"backend.app.routes.{module}.get_current_user", return_value=admin_user()))
                stack.enter_context(patch(f"backend.app.routes.{module}.WorkflowService", return_value=self.service))
            for method, path, payload, expected_status in cases:
                with self.subTest(method=method, path=path):
                    response = self.client.open(path, method=method, json=payload)
                    self.assertEqual(response.status_code, expected_status, response.get_data(as_text=True))
                    self.assertTrue(response.is_json)


if __name__ == "__main__":
    unittest.main()
