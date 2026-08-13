from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests
from flask import current_app, request


@dataclass
class CurrentUser:
    id: str
    email: str
    name: str


class AuthError(Exception):
    pass


def _ensure_dev_user(dev_email: str) -> CurrentUser:
    from .supabase_service import SupabaseService

    supabase = SupabaseService()
    existing = supabase.select("app_users", filters={"email": f"eq.{dev_email}"})
    if existing:
        user = existing[0]
        return CurrentUser(
            id=user["id"],
            email=user["email"],
            name=user.get("full_name") or dev_email.split("@")[0],
        )

    create_response = requests.post(
        f"{current_app.config['SUPABASE_URL']}/auth/v1/admin/users",
        headers={
            "apikey": current_app.config["SUPABASE_SERVICE_ROLE_KEY"],
            "Authorization": f"Bearer {current_app.config['SUPABASE_SERVICE_ROLE_KEY']}",
            "Content-Type": "application/json",
        },
        json={
            "email": dev_email,
            "email_confirm": True,
            "user_metadata": {
                "full_name": dev_email.split("@")[0].replace(".", " ").title(),
            },
        },
        timeout=20,
    )
    create_response.raise_for_status()
    created_auth_user: dict[str, Any] = create_response.json()

    full_name = (
        (created_auth_user.get("user_metadata") or {}).get("full_name")
        or dev_email.split("@")[0].replace(".", " ").title()
    )

    created_app_user = supabase.insert(
        "app_users",
        {
            "id": created_auth_user["id"],
            "email": dev_email,
            "full_name": full_name,
            "area": "Operacao",
            "role_name": "Administrador",
            "is_active": True,
            "is_online": True,
        },
    )

    return CurrentUser(
        id=created_app_user["id"],
        email=created_app_user["email"],
        name=created_app_user.get("full_name") or full_name,
    )


def get_current_user() -> CurrentUser:
    dev_email = request.headers.get("X-Dev-User-Email")
    if dev_email:
        return _ensure_dev_user(dev_email)

    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        raise AuthError("Authorization Bearer token nao informado.")

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise AuthError("Token vazio.")

    response = requests.get(
        f"{current_app.config['SUPABASE_URL']}/auth/v1/user",
        headers={
            "apikey": current_app.config["SUPABASE_ANON_KEY"],
            "Authorization": f"Bearer {token}",
        },
        timeout=15,
    )

    if response.status_code != 200:
        raise AuthError("Nao foi possivel validar o usuario no Supabase.")

    payload: dict[str, Any] = response.json()
    email = payload.get("email") or ""
    metadata = payload.get("user_metadata") or {}

    return CurrentUser(
        id=payload.get("id", ""),
        email=email,
        name=metadata.get("full_name") or metadata.get("name") or email,
    )
