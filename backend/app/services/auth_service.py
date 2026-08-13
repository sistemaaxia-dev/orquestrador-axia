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


def get_current_user() -> CurrentUser:
    dev_email = request.headers.get("X-Dev-User-Email")
    if dev_email:
        return CurrentUser(id="dev-user", email=dev_email, name=dev_email.split("@")[0])

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
