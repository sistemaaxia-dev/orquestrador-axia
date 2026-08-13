from flask import Blueprint, jsonify, request

from ..services.auth_service import AuthError, get_current_user
from ..services.supabase_service import SupabaseService


logs_bp = Blueprint("logs", __name__)


@logs_bp.get("/logs")
def list_logs():
    try:
        get_current_user()
    except AuthError as error:
        return jsonify({"error": str(error)}), 401

    workflow_id = request.args.get("workflow_id")
    filters = {"workflow_id": f"eq.{workflow_id}"} if workflow_id else None

    supabase = SupabaseService()
    rows = supabase.select(
        "activity_history",
        filters=filters,
        order="performed_at.desc",
    )
    return jsonify(rows)
