from __future__ import annotations

import secrets
import string
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import requests
from flask import current_app, request

from .email_service import EmailService
from .supabase_service import SupabaseService
from .audit_service import AuditService


@dataclass
class CurrentUser:
    id: str
    email: str
    name: str
    role: str
    is_admin: bool
    first_login_required: bool
    is_active: bool


class AuthError(Exception):
    pass


def _generate_temporary_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%&*?"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _auth_admin_endpoint(path: str) -> str:
    return f"{current_app.config['SUPABASE_URL'].rstrip('/')}/auth/v1/admin{path}"


def _auth_public_endpoint(path: str) -> str:
    return f"{current_app.config['SUPABASE_URL'].rstrip('/')}/auth/v1{path}"


def _load_profile(user_id: str) -> dict[str, Any]:
    supabase = SupabaseService()
    profile = supabase.get_one("user_profiles", filters={"id": f"eq.{user_id}"})
    if not profile:
        raise AuthError("Perfil do usuario nao encontrado.")
    if not profile.get("is_active", False):
        raise AuthError("Seu acesso esta inativo.")
    return profile


def get_current_user() -> CurrentUser:
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        raise AuthError("Authorization Bearer token nao informado.")

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise AuthError("Token vazio.")

    response = requests.get(
        _auth_public_endpoint("/user"),
        headers={
            "apikey": current_app.config["SUPABASE_ANON_KEY"],
            "Authorization": f"Bearer {token}",
        },
        timeout=20,
    )

    if response.status_code != 200:
        raise AuthError("Nao foi possivel validar a sessao no Supabase.")

    payload: dict[str, Any] = response.json()
    profile = _load_profile(payload["id"])
    metadata = payload.get("user_metadata") or {}
    operational_role = str(metadata.get("operational_role") or profile["role"])
    operational_role = {"user": "usuario", "admin": "usuario_chave"}.get(operational_role, operational_role)
    return CurrentUser(
        id=payload["id"],
        email=str(profile["email"]),
        name=str(profile["name"]),
        role=operational_role,
        is_admin=operational_role in {"admin", "usuario_chave"},
        first_login_required=bool(profile["first_login_required"]),
        is_active=bool(profile["is_active"]),
    )


def require_admin(user: CurrentUser) -> None:
    if not user.is_admin:
        raise AuthError("Acesso restrito a administradores.")


def create_auth_user(
    email: str,
    name: str,
    temporary_password: str,
    *,
    operational_role: str | None = None,
    team_name: str | None = None,
    team_email: str | None = None,
) -> dict[str, Any]:
    supabase = SupabaseService()
    user_metadata = {
        "full_name": name,
        "operational_role": operational_role,
        "team_name": team_name,
        "team_email": team_email,
    }
    response = requests.post(
        _auth_admin_endpoint("/users"),
        headers=supabase.admin_headers(),
        json={
            "email": email,
            "password": temporary_password,
            "email_confirm": True,
            "user_metadata": {key: value for key, value in user_metadata.items() if value is not None},
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def update_auth_user_metadata(
    user_id: str,
    *,
    email: str,
    name: str,
    operational_role: str,
    team_name: str | None,
    team_email: str | None,
) -> None:
    supabase = SupabaseService()
    response = requests.put(
        _auth_admin_endpoint(f"/users/{user_id}"),
        headers=supabase.admin_headers(),
        json={
            "email": email,
            "user_metadata": {
                "full_name": name,
                "operational_role": operational_role,
                "team_name": team_name,
                "team_email": team_email,
            }
        },
        timeout=30,
    )
    response.raise_for_status()


def delete_auth_user(user_id: str) -> None:
    supabase = SupabaseService()
    response = requests.delete(
        _auth_admin_endpoint(f"/users/{user_id}"),
        headers=supabase.admin_headers(),
        timeout=30,
    )
    response.raise_for_status()


def list_auth_user_metadata() -> dict[str, dict[str, Any]]:
    supabase = SupabaseService()
    response = requests.get(
        _auth_admin_endpoint("/users"),
        headers=supabase.admin_headers(),
        params={"page": 1, "per_page": 1000},
        timeout=30,
    )
    response.raise_for_status()
    return {row["id"]: row.get("user_metadata") or {} for row in response.json().get("users", [])}


def update_auth_user_password(user_id: str, new_password: str) -> None:
    supabase = SupabaseService()
    response = requests.put(
        _auth_admin_endpoint(f"/users/{user_id}"),
        headers=supabase.admin_headers(),
        json={"password": new_password},
        timeout=30,
    )
    response.raise_for_status()


def send_first_access_password(email: str) -> None:
    supabase = SupabaseService()
    profile = supabase.get_one("user_profiles", filters={"email": f"eq.{email}"}, use_service_role=True)
    if not profile or not profile.get("is_active", False):
        return

    temporary_password = _generate_temporary_password()
    update_auth_user_password(profile["id"], temporary_password)
    supabase.update(
        "user_profiles",
        {"id": f"eq.{profile['id']}"},
        {
            "first_login_required": True,
            "temporary_password_sent_at": datetime.now(timezone.utc).isoformat(),
        },
        use_service_role=True,
    )

    EmailService().send_email(
        to_email=str(profile["email"]),
        subject="Sua senha temporaria do Projeto Axiom",
        text=(
            "Sua senha temporaria foi gerada com sucesso.\n\n"
            f"Senha temporaria: {temporary_password}\n"
            "Ao entrar, voce precisara definir uma nova senha imediatamente."
        ),
    )
    AuditService().log(
        user=None,
        action="auth.temporary_password_sent",
        entity_type="user_profile",
        entity_id=profile["id"],
        details={"email": profile["email"]},
    )


def complete_first_login(user: CurrentUser, new_password: str) -> None:
    update_auth_user_password(user.id, new_password)
    supabase = SupabaseService()
    supabase.update(
        "user_profiles",
        {"id": f"eq.{user.id}"},
        {"first_login_required": False},
    )


def register_user(name: str, email: str, password: str) -> dict[str, Any]:
    normalized_email = email.strip().lower()
    normalized_name = name.strip() or normalized_email.split("@")[0]
    if "@" not in normalized_email:
        raise AuthError("Informe um e-mail válido.")
    if len(password) < 8:
        raise AuthError("A senha precisa ter pelo menos 8 caracteres.")

    supabase = SupabaseService()
    existing = supabase.get_one(
        "user_profiles",
        filters={"email": f"eq.{normalized_email}"},
        use_service_role=True,
    )
    if existing:
        raise AuthError("Este e-mail já está cadastrado. Faça login.")

    auth_user = create_auth_user(normalized_email, normalized_name, password)
    profile = supabase.insert(
        "user_profiles",
        {
            "id": auth_user["id"],
            "email": normalized_email,
            "name": normalized_name,
            "role": "user",
            "is_active": True,
            "first_login_required": False,
        },
        use_service_role=True,
    )
    AuditService().log(
        user=None,
        action="auth.registered",
        entity_type="user_profile",
        entity_id=profile["id"],
        details={"email": normalized_email},
    )
    return profile
