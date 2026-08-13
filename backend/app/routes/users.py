from flask import Blueprint, jsonify

from ..services.auth_service import AuthError, get_current_user
from ..services.supabase_service import SupabaseService


users_bp = Blueprint("users", __name__)


@users_bp.get("/users")
def list_users():
    try:
        get_current_user()
    except AuthError as error:
        return jsonify({"error": str(error)}), 401

    supabase = SupabaseService()
    rows = supabase.select("app_users", order="full_name.asc")
    return jsonify(rows)
