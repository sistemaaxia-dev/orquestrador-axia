from flask import Blueprint, jsonify, request

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


@users_bp.patch("/users/<user_id>")
def update_user(user_id: str):
    try:
        get_current_user()
    except AuthError as error:
        return jsonify({"error": str(error)}), 401

    payload = request.get_json(silent=True) or {}
    allowed_fields = {
        "full_name",
        "email",
        "area",
        "role_name",
        "is_active",
        "is_online",
    }
    update_payload = {key: value for key, value in payload.items() if key in allowed_fields}
    if not update_payload:
        return jsonify({"error": "Nenhum campo valido para atualizar."}), 400

    supabase = SupabaseService()
    updated = supabase.update("app_users", {"id": f"eq.{user_id}"}, update_payload)
    return jsonify(updated)
