from flask import Blueprint, jsonify, request

from ..services.auth_service import AuthError, get_current_user
from ..services.workflow_service import WorkflowError, WorkflowService


activities_bp = Blueprint("activities", __name__)


@activities_bp.get("/activities")
def all_activities():
    try:
        return jsonify(WorkflowService().list_all_activities(get_current_user()))
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@activities_bp.get("/activities/my")
def my_activities():
    try:
        user = get_current_user()
        service = WorkflowService()
        rows = service.list_all_activities(user)
        filtered = [
            row
            for row in rows
            if user.id in {
                row.get("responsible_user_id"),
                row.get("responsible_backup_user_id"),
                row.get("approver_user_id"),
            }
        ]
        return jsonify(filtered)
    except AuthError as error:
        return jsonify({"error": str(error)}), 401


@activities_bp.patch("/workflow-activities/<activity_id>")
def update_activity(activity_id: str):
    try:
        user = get_current_user()
        updated = WorkflowService().update_workflow_activity(activity_id, user, request.get_json(silent=True) or {})
        return jsonify(updated)
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@activities_bp.delete("/workflow-activities/<activity_id>")
def delete_activity(activity_id: str):
    try:
        user = get_current_user()
        WorkflowService().delete_workflow_activity(activity_id, user)
        return jsonify({"message": "Atividade excluida."})
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@activities_bp.post("/workflow-activities/<activity_id>/actions")
def act_on_activity(activity_id: str):
    try:
        user = get_current_user()
        updated = WorkflowService().act_on_activity(activity_id, user, request.get_json(silent=True) or {})
        return jsonify(updated)
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@activities_bp.post("/workflow-activities/<activity_id>/attachments")
def upload_attachment(activity_id: str):
    try:
        user = get_current_user()
        if "file" not in request.files:
            return jsonify({"error": "Arquivo nao informado."}), 400
        uploaded = WorkflowService().upload_attachment(activity_id, user, request.files["file"])
        return jsonify(uploaded), 201
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@activities_bp.post("/workflow-activities/<activity_id>/complete")
def complete_activity(activity_id: str):
    try:
        user = get_current_user()
        completed = WorkflowService().complete_activity_with_attachment(
            activity_id,
            user,
            request.files.get("file"),
        )
        return jsonify(completed)
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400
