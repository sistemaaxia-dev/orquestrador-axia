from flask import Blueprint, jsonify, request

from ..services.audit_service import AuditService
from ..services.auth_service import AuthError, complete_first_login, get_current_user, register_user, send_first_access_password


auth_bp = Blueprint("auth", __name__)


@auth_bp.post("/auth/register")
def register():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", ""))
    email = str(payload.get("email", ""))
    password = str(payload.get("password", ""))
    confirm_password = str(payload.get("confirm_password", ""))
    if password != confirm_password:
        return jsonify({"error": "A confirmação da senha não confere."}), 400
    try:
        register_user(name, email, password)
    except AuthError as error:
        return jsonify({"error": str(error)}), 400
    except Exception:
        return jsonify({"error": "Não foi possível concluir o cadastro agora."}), 500
    return jsonify({"message": "Cadastro realizado com sucesso. Agora você já pode entrar."}), 201


@auth_bp.post("/auth/start-access")
def start_access() -> tuple[dict[str, str], int]:
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    if email:
        try:
            send_first_access_password(email)
        except Exception:
            pass
    return (
        {
            "message": (
                "Se o e-mail estiver autorizado, uma senha temporaria sera enviada."
            )
        },
        200,
    )


@auth_bp.get("/auth/profile")
def profile():
    try:
        user = get_current_user()
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    return jsonify(
        {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "is_admin": user.is_admin,
            "first_login_required": user.first_login_required,
        }
    )


@auth_bp.post("/auth/complete-first-login")
def finish_first_login():
    try:
        user = get_current_user()
    except AuthError as error:
        return jsonify({"error": str(error)}), 401

    payload = request.get_json(silent=True) or {}
    new_password = str(payload.get("new_password", ""))
    confirm_password = str(payload.get("confirm_password", ""))
    if len(new_password) < 10:
        return jsonify({"error": "A nova senha precisa ter pelo menos 10 caracteres."}), 400
    if new_password != confirm_password:
        return jsonify({"error": "A confirmacao da senha nao confere."}), 400

    try:
        complete_first_login(user, new_password)
        AuditService().log(
            user=user,
            action="auth.first_login_completed",
            entity_type="user_profile",
            entity_id=user.id,
        )
    except Exception as error:
        return jsonify({"error": str(error)}), 400

    return jsonify({"message": "Senha atualizada com sucesso."})
