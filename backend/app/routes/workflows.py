from flask import Blueprint, jsonify, request

from ..services.auth_service import AuthError, get_current_user
from ..services.workflow_service import WorkflowError, WorkflowService


workflows_bp = Blueprint("workflows", __name__)


@workflows_bp.get("/workflows")
def list_workflows():
    try:
        user = get_current_user()
        rows = WorkflowService().list_workflows(user)
        return jsonify(rows)
    except AuthError as error:
        return jsonify({"error": str(error)}), 401


@workflows_bp.post("/workflows")
def create_workflow():
    try:
        user = get_current_user()
        created = WorkflowService().create_workflow(user, request.get_json(silent=True) or {})
        return jsonify(created), 201
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@workflows_bp.patch("/workflows/<workflow_id>")
def update_workflow(workflow_id: str):
    try:
        user = get_current_user()
        return jsonify(WorkflowService().update_workflow(workflow_id, user, request.get_json(silent=True) or {}))
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@workflows_bp.post("/workflows/<workflow_id>/duplicate")
def duplicate_workflow(workflow_id: str):
    try:
        user = get_current_user()
        return jsonify(WorkflowService().duplicate_workflow(workflow_id, user)), 201
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@workflows_bp.delete("/workflows/<workflow_id>")
def delete_workflow(workflow_id: str):
    try:
        user = get_current_user()
        WorkflowService().delete_workflow(workflow_id, user)
        return jsonify({"message": "Workflow excluido."})
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@workflows_bp.get("/workflows/<workflow_id>/activities")
def list_workflow_activities(workflow_id: str):
    try:
        user = get_current_user()
        rows = WorkflowService().list_workflow_activities(workflow_id, user)
        return jsonify(rows)
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@workflows_bp.post("/workflows/<workflow_id>/activities")
def create_workflow_activity(workflow_id: str):
    try:
        user = get_current_user()
        created = WorkflowService().create_workflow_activity(workflow_id, user, request.get_json(silent=True) or {})
        return jsonify(created), 201
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@workflows_bp.post("/workflows/<workflow_id>/activity-links")
def link_templates(workflow_id: str):
    try:
        user = get_current_user()
        payload = request.get_json(silent=True) or {}
        rows = WorkflowService().link_templates_to_workflow(workflow_id, user, payload.get("template_ids") or [])
        return jsonify(rows)
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@workflows_bp.get("/activity-templates")
def list_templates():
    try:
        user = get_current_user()
        rows = WorkflowService().list_templates(user)
        return jsonify(rows)
    except AuthError as error:
        return jsonify({"error": str(error)}), 401


@workflows_bp.post("/activity-templates")
def create_template():
    try:
        user = get_current_user()
        created = WorkflowService().create_template(user, request.get_json(silent=True) or {})
        return jsonify(created), 201
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@workflows_bp.patch("/activity-templates/<template_id>")
def update_template(template_id: str):
    try:
        user = get_current_user()
        updated = WorkflowService().update_template(user, template_id, request.get_json(silent=True) or {})
        return jsonify(updated)
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400
