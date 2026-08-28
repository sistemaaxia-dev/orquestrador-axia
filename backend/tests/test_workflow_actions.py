from __future__ import annotations

from datetime import date
import unittest
from unittest.mock import MagicMock, patch

from backend.app.services.auth_service import CurrentUser
from backend.app.services.workflow_service import WorkflowError, WorkflowService


class FakeSupabase:
    def __init__(self, activity: dict):
        self.activity = dict(activity)
        self.updates: list[dict] = []
        self.profiles: dict[str, dict] = {}

    def update(self, resource: str, filters: dict, payload: dict, **_kwargs) -> dict:
        self.updates.append({"resource": resource, "filters": filters, "payload": dict(payload)})
        if resource == "workflow_activities":
            self.activity.update(payload)
            return dict(self.activity)
        return dict(payload)

    def get_one(self, resource: str, *, filters: dict, **_kwargs):
        if resource == "workflow_activities":
            return dict(self.activity)
        if resource == "user_profiles":
            user_id = filters["id"].removeprefix("eq.")
            return self.profiles.get(user_id)
        return None


def make_user(user_id: str, *, admin: bool = False) -> CurrentUser:
    return CurrentUser(
        id=user_id,
        email=f"{user_id}@example.com",
        name=user_id,
        role="admin" if admin else "usuario",
        is_admin=admin,
        first_login_required=False,
        is_active=True,
    )


def make_activity(**overrides) -> dict:
    activity = {
        "id": "activity-1",
        "workflow_id": "workflow-1",
        "name_snapshot": "Fechamento fiscal",
        "status": "Nao iniciada",
        "approval_status": "Nao aplicavel",
        "responsible_user_id": "responsible-1",
        "responsible_backup_user_id": "backup-1",
        "approver_user_id": "approver-1",
        "requires_attachment_snapshot": False,
        "requires_approval_snapshot": True,
        "expected_end_date": "2026-08-31",
        "start_date": "2026-08-21",
    }
    activity.update(overrides)
    return activity


class WorkflowActionTests(unittest.TestCase):
    def test_workflow_creation_retries_without_unmigrated_is_active_column(self):
        service = object.__new__(WorkflowService)
        service.supabase = MagicMock()
        service.audit = MagicMock()
        service._require_key_user = MagicMock()
        legacy_payload = {
            "name": "Fiscal - Mensal Copia",
            "description": "",
            "routine": "Mensal",
            "period": "09/2026",
            "start_at": "2026-09-01T00:00:00+00:00",
            "due_at": "2026-09-30T00:00:00+00:00",
            "status": "Nao iniciado",
            "is_active": False,
            "created_by": "admin-1",
        }
        service._workflow_insert_payload = MagicMock(return_value=(legacy_payload, {"id": "admin-1"}))
        response = MagicMock()
        response.json.return_value = {"code": "PGRST204", "message": "column is_active does not exist"}
        missing_column = RuntimeError("Bad Request")
        missing_column.response = response

        def insert(resource, payload, **_kwargs):
            if resource == "workflows" and "is_active" in payload:
                raise missing_column
            if resource == "workflows":
                return {"id": "workflow-copy", **payload}
            return {"id": "participant-1", **payload}

        service.supabase.insert.side_effect = insert

        result = service.create_workflow(make_user("admin-1", admin=True), {
            "name": "Fiscal - Mensal Copia",
            "routine": "mensal",
            "month": 9,
            "year": 2026,
            "start_date": "2026-09-01",
            "expected_end_date": "2026-09-30",
        })

        workflow_inserts = [call.args[1] for call in service.supabase.insert.call_args_list if call.args[0] == "workflows"]
        self.assertEqual(len(workflow_inserts), 2)
        self.assertIn("is_active", workflow_inserts[0])
        self.assertNotIn("is_active", workflow_inserts[1])
        self.assertEqual(result["name"], "Fiscal - Mensal Copia")
        self.assertFalse(result["is_active"])

    def test_business_day_deadline_accepts_negative_values_from_prior_month_close(self):
        service = object.__new__(WorkflowService)
        service.supabase = MagicMock()
        service.supabase.get_one.return_value = None

        self.assertEqual(service._deadline_from_month_close(date(2025, 9, 1), 3, None), date(2025, 9, 3))
        self.assertEqual(service._deadline_from_month_close(date(2025, 9, 1), -2, None), date(2025, 8, 27))

    def test_routine_date_shift_preserves_schedule_cycle(self):
        service = object.__new__(WorkflowService)

        self.assertEqual(service._shift_date_by_routine("2026-01-31", "mensal"), "2026-02-28")
        self.assertEqual(service._shift_date_by_routine("2026-01-15", "trimestral"), "2026-04-15")

    def test_fixed_date_requires_manual_business_day_adjustment(self):
        service = object.__new__(WorkflowService)
        service.supabase = MagicMock()
        service.supabase.get_one.return_value = None

        self.assertFalse(service._is_business_day(date(2026, 8, 30), None))
        self.assertTrue(service._is_business_day(date(2026, 8, 31), None))

    def test_deadline_preview_uses_workflow_business_day_base(self):
        service = object.__new__(WorkflowService)
        service.supabase = MagicMock()
        service.supabase.get_one.return_value = None

        result = service.preview_deadline(
            make_user("responsible-1"),
            {"last_business_day": "2025-08-29", "deadline_days": 3},
        )

        self.assertEqual(result["expected_end_date"], "2025-09-03")

    def test_activated_workflow_cannot_be_inactivated_even_by_admin(self):
        service = object.__new__(WorkflowService)
        service.supabase = MagicMock()
        service.audit = MagicMock()
        service._require_key_user = MagicMock()
        service._require_workflow_access = MagicMock(return_value={
            "id": "workflow-1", "name": "Fechamento", "routine": "Mensal", "period": "08/2026",
            "start_at": "2026-08-01T00:00:00+00:00", "due_at": "2026-08-31T00:00:00+00:00",
            "status": "Em andamento", "is_active": True,
        })

        with self.assertRaisesRegex(WorkflowError, "nao pode ser inativado"):
            service.update_workflow("workflow-1", make_user("admin-1", admin=True), {"is_active": False})

    def test_workflow_master_can_edit_full_schedule(self):
        service = object.__new__(WorkflowService)
        service.supabase = MagicMock()
        service.audit = MagicMock()
        service._require_key_user = MagicMock()
        current = {
            "id": "workflow-1", "name": "Fechamento", "description": "Anterior", "routine": "Mensal",
            "period": "08/2026", "start_at": "2026-08-01T00:00:00+00:00",
            "due_at": "2026-08-31T00:00:00+00:00", "status": "Nao iniciado", "is_active": False,
        }
        service._require_workflow_access = MagicMock(return_value=current)
        service.supabase.update.return_value = {
            **current, "name": "Fechamento Novo", "description": "Revisado", "routine": "Trimestral",
            "period": "09/2026", "start_at": "2026-09-01T00:00:00+00:00", "due_at": "2026-09-30T00:00:00+00:00",
        }

        result = service.update_workflow("workflow-1", make_user("admin-1", admin=True), {
            "name": "Fechamento Novo", "description": "Revisado", "routine": "trimestral",
            "month": 9, "year": 2026, "start_date": "2026-09-01", "expected_end_date": "2026-09-30",
        })

        payload = service.supabase.update.call_args.args[2]
        self.assertEqual(payload["period"], "09/2026")
        self.assertEqual(payload["routine"], "Trimestral")
        self.assertEqual(result["expected_end_date"], "2026-09-30")

    def test_workflow_does_not_start_only_because_an_activity_date_is_reached(self):
        service = object.__new__(WorkflowService)
        service._today = MagicMock(return_value=date(2026, 8, 25))

        status = service._workflow_execution_status(
            {"start_at": "2026-08-25T00:00:00+00:00", "is_active": False},
            [{"status": "Nao iniciada", "start_date": "2026-08-25"}],
        )

        self.assertEqual(status, "Nao iniciado")

    def test_activated_workflow_is_in_progress_regardless_of_activity_dates(self):
        service = object.__new__(WorkflowService)
        service._today = MagicMock(return_value=date(2026, 8, 25))

        status = service._workflow_execution_status(
            {"start_at": "2026-08-26T00:00:00+00:00", "is_active": True},
            [{"status": "Nao iniciada", "start_date": "2026-08-26"}],
        )

        self.assertEqual(status, "Em andamento")

    def test_completed_activities_make_workflow_completed(self):
        service = object.__new__(WorkflowService)
        service._today = MagicMock(return_value=date(2026, 8, 25))

        status = service._workflow_execution_status(
            {"start_at": "2026-08-26T00:00:00+00:00"},
            [{"status": "Concluida"}, {"status": "Concluida"}],
        )

        self.assertEqual(status, "Concluido")

    def test_workflow_delete_audit_does_not_reference_deleted_foreign_key(self):
        service = object.__new__(WorkflowService)
        service.supabase = MagicMock()
        service.audit = MagicMock()
        service._require_admin = MagicMock()
        workflow = {"id": "workflow-1", "name": "Fechamento"}
        service._require_workflow_access = MagicMock(return_value=workflow)

        service.delete_workflow("workflow-1", make_user("admin-1", admin=True))

        service.supabase.delete.assert_called_once_with("workflows", {"id": "eq.workflow-1"})
        self.assertIsNone(service.audit.log.call_args.kwargs["workflow_id"])
        self.assertEqual(service.audit.log.call_args.kwargs["details"]["deleted_workflow_id"], "workflow-1")

    def test_only_master_can_delete_completed_activity(self):
        service, fake = self.make_service(make_activity(status="Concluida"))
        fake.delete = MagicMock()

        with self.assertRaisesRegex(WorkflowError, "Administrador Master"):
            service.delete_workflow_activity("activity-1", make_user("responsible-1"))

        service.delete_workflow_activity("activity-1", make_user("admin-1", admin=True))
        fake.delete.assert_called_once_with("workflow_activities", {"id": "eq.activity-1"})

    def make_service(self, activity: dict) -> tuple[WorkflowService, FakeSupabase]:
        service = object.__new__(WorkflowService)
        fake = FakeSupabase(activity)
        service.supabase = fake
        service.audit = MagicMock()
        service._require_activity_access = MagicMock(side_effect=lambda *_args, **_kwargs: dict(fake.activity))
        service._recompute_activity_statuses = MagicMock()
        service._notify_next_activity_by_date = MagicMock()
        return service, fake

    def test_responsible_can_complete_activity(self):
        service, _fake = self.make_service(make_activity(requires_approval_snapshot=False))

        result = service.act_on_activity("activity-1", make_user("responsible-1"), {"action": "complete"})

        self.assertEqual(result["status"], "Concluida")
        self.assertEqual(result["completed_by"], "responsible-1")
        service._notify_next_activity_by_date.assert_called_once()

    def test_backup_can_complete_activity(self):
        service, _fake = self.make_service(make_activity(requires_approval_snapshot=False))

        result = service.act_on_activity("activity-1", make_user("backup-1"), {"action": "complete"})

        self.assertEqual(result["status"], "Concluida")

    def test_unassigned_user_cannot_complete_activity(self):
        service, _fake = self.make_service(make_activity())

        with self.assertRaisesRegex(WorkflowError, "Somente o responsavel"):
            service.act_on_activity("activity-1", make_user("other-1"), {"action": "complete"})

    def test_only_approver_or_admin_can_decide(self):
        pending = make_activity(status="Pendente de aprovacao", approval_status="Pendente")
        service, _fake = self.make_service(pending)

        with self.assertRaisesRegex(WorkflowError, "Somente o aprovador"):
            service.act_on_activity("activity-1", make_user("responsible-1"), {"action": "approve"})

        result = service.act_on_activity("activity-1", make_user("admin-1", admin=True), {"action": "approve"})
        self.assertEqual(result["status"], "Concluida")
        self.assertEqual(result["approval_status"], "Aprovada")

    def test_approval_cannot_skip_pending_state(self):
        service, _fake = self.make_service(make_activity())

        with self.assertRaisesRegex(WorkflowError, "nao esta pendente"):
            service.act_on_activity("activity-1", make_user("approver-1"), {"action": "approve"})

    def test_complete_cannot_bypass_required_approval(self):
        service, _fake = self.make_service(make_activity())

        with self.assertRaisesRegex(WorkflowError, "enviada para aprovacao"):
            service.act_on_activity("activity-1", make_user("responsible-1"), {"action": "complete"})

    def test_submission_notifies_only_approver(self):
        service, fake = self.make_service(make_activity())
        service._send_activity_notification = MagicMock(return_value=True)

        result = service.act_on_activity("activity-1", make_user("responsible-1"), {"action": "submit_for_approval"})

        self.assertTrue(result["notification_sent"])
        self.assertEqual(result["status"], "Pendente de aprovacao")
        self.assertEqual(service._send_activity_notification.call_args.kwargs["roles"], ("approver",))
        self.assertFalse(service._send_activity_notification.call_args.kwargs["include_team"])
        self.assertTrue(any("approval_notification_sent_at" in row["payload"] for row in fake.updates))

    def test_failed_email_does_not_mark_notification_as_sent(self):
        service, fake = self.make_service(make_activity())
        service._send_activity_notification = MagicMock(return_value=False)

        result = service.act_on_activity("activity-1", make_user("responsible-1"), {"action": "submit_for_approval"})

        self.assertFalse(result["notification_sent"])
        marker_updates = [row for row in fake.updates if "approval_notification_sent_at" in row["payload"] and row["payload"]["approval_notification_sent_at"]]
        self.assertEqual(marker_updates, [])

    def test_rejection_returns_same_activity_for_rework_and_emails_reason(self):
        pending = make_activity(status="Pendente de aprovacao", approval_status="Pendente")
        service, _fake = self.make_service(pending)
        service._send_activity_notification = MagicMock(return_value=True)

        result = service.act_on_activity(
            "activity-1",
            make_user("approver-1"),
            {"action": "reject", "notes": "Corrigir o saldo informado"},
        )

        self.assertEqual(result["status"], "Nao iniciada")
        self.assertEqual(result["approval_status"], "Reprovada")
        call = service._send_activity_notification.call_args
        self.assertIn("Corrigir o saldo informado", call.args[2])
        self.assertEqual(call.kwargs["roles"], ("responsible",))
        self.assertFalse(call.kwargs["include_team"])

    def test_rejection_requires_reason(self):
        pending = make_activity(status="Pendente de aprovacao", approval_status="Pendente")
        service, _fake = self.make_service(pending)

        with self.assertRaisesRegex(WorkflowError, "motivo da reprovacao"):
            service.act_on_activity("activity-1", make_user("approver-1"), {"action": "reject", "notes": ""})

    @patch("backend.app.services.workflow_service.EmailService")
    def test_recipient_resolution_routes_approval_to_test_address(self, email_service_class):
        service, fake = self.make_service(make_activity())
        fake.profiles["approver-1"] = {
            "id": "approver-1",
            "email": "achadinhosmc16@gmail.com",
            "is_active": True,
        }

        sent = service._send_activity_notification(
            fake.activity,
            "Teste de aprovacao",
            "Atividade pronta para aprovar.",
            roles=("approver",),
            include_team=False,
            user=make_user("responsible-1"),
        )

        self.assertTrue(sent)
        email_service_class.return_value.send_email.assert_called_once_with(
            to_email="achadinhosmc16@gmail.com",
            subject="Teste de aprovacao",
            text="Atividade pronta para aprovar.",
            use_redirect=False,
        )

    @patch("backend.app.services.workflow_service.EmailService")
    def test_attachment_email_has_power_automate_routing_contract(self, email_service_class):
        service = object.__new__(WorkflowService)
        service.supabase = MagicMock()
        service.supabase.get_one.return_value = {
            "id": "workflow-1",
            "name": "Fechamento Fiscal",
            "description": "",
            "routine": "Mensal",
            "period": "08/2026",
            "start_at": "2026-08-01T00:00:00+00:00",
            "due_at": "2026-08-31T00:00:00+00:00",
            "status": "Em andamento",
        }
        email_service = email_service_class.return_value
        email_service.attachment_to = "aline.valle@eletrobras.com"
        file = MagicMock()
        file.filename = "balancete-agosto.xlsx"
        file.mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        file.read.return_value = b"arquivo"
        activity = make_activity(
            id="activity-99",
            workflow_id="workflow-1",
            name_snapshot="Conferir balancete",
            company_snapshot="Eletrobras",
        )

        routing = service._send_attachment_email(activity, make_user("responsible-1"), file)

        call = email_service.send_email.call_args.kwargs
        self.assertEqual(call["to_email"], "aline.valle@eletrobras.com")
        self.assertTrue(call["subject"].startswith("CHAVE|ENVIO="))
        self.assertIn("|WORKFLOW=workflow-1|ATIVIDADE=activity-99|PERIODO=2026-08", call["subject"])
        self.assertIn("CHAVE=AXIOM_ATTACHMENT", call["text"])
        self.assertIn("WORKFLOW_NOME=Fechamento Fiscal", call["text"])
        self.assertIn("EMPRESA=Eletrobras", call["text"])
        self.assertEqual(call["attachments"][0][0], "balancete-agosto.xlsx")
        self.assertFalse(call["use_redirect"])
        self.assertEqual(routing["workflow_id"], "workflow-1")
        self.assertIn(f"ENVIO_ID={routing['submission_id']}", call["text"])


if __name__ == "__main__":
    unittest.main()
