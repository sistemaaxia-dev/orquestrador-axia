from flask import Blueprint, jsonify, request

from ..services.auth_service import AuthError, get_current_user
from ..services.workflow_service import WorkflowError, WorkflowService


logs_bp = Blueprint("logs", __name__)


@logs_bp.get("/logs")
def list_logs():
    try:
        user = get_current_user()
        workflow_id = request.args.get("workflow_id")
        rows = WorkflowService().list_logs(user, workflow_id)
        return jsonify(rows)
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400
