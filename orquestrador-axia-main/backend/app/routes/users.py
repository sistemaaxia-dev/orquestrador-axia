from flask import Blueprint, jsonify, request

from ..services.auth_service import AuthError, get_current_user
from ..services.workflow_service import WorkflowError, WorkflowService


users_bp = Blueprint("users", __name__)


@users_bp.get("/users")
def list_users():
    try:
        user = get_current_user()
        return jsonify(WorkflowService().list_users(user))
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@users_bp.post("/users")
def create_user():
    try:
        user = get_current_user()
        created = WorkflowService().create_user(user, request.get_json(silent=True) or {})
        return jsonify(created), 201
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@users_bp.patch("/users/<user_id>")
def update_user(user_id: str):
    try:
        user = get_current_user()
        updated = WorkflowService().update_user(user, user_id, request.get_json(silent=True) or {})
        return jsonify(updated)
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400
