from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import requests
from flask import current_app, has_request_context, request


class SupabaseService:
    def __init__(self) -> None:
        self.base_url = current_app.config["SUPABASE_URL"].rstrip("/")
        self.schema = current_app.config["SUPABASE_SCHEMA"]
        self.anon_key = current_app.config["SUPABASE_ANON_KEY"]
        self.service_role_key = current_app.config["SUPABASE_SERVICE_ROLE_KEY"] or self.anon_key

    def _user_jwt(self) -> str:
        if not has_request_context():
            return ""
        authorization = request.headers.get("Authorization", "")
        if authorization.startswith("Bearer "):
            return authorization.removeprefix("Bearer ").strip()
        return ""

    def _headers(self, *, use_service_role: bool = True) -> dict[str, str]:
        jwt = self.service_role_key if use_service_role else self._user_jwt()
        api_key = self.service_role_key if use_service_role else self.anon_key
        return {
            "apikey": api_key,
            "Authorization": f"Bearer {jwt or api_key}",
            "Content-Type": "application/json",
            "Accept-Profile": self.schema,
            "Content-Profile": self.schema,
        }

    def _endpoint(self, resource: str) -> str:
        return f"{self.base_url}/rest/v1/{resource}"

    def select(
        self,
        resource: str,
        *,
        select: str = "*",
        filters: dict[str, str] | None = None,
        order: str | None = None,
        limit: int | None = None,
        use_service_role: bool = True,
    ) -> list[dict[str, Any]]:
        params: dict[str, str] = {"select": select}
        if filters:
            params.update(filters)
        if order:
            params["order"] = order
        if limit is not None:
            params["limit"] = str(limit)

        response = requests.get(
            f"{self._endpoint(resource)}?{urlencode(params)}",
            headers=self._headers(use_service_role=use_service_role),
            timeout=30,
        )
        response.raise_for_status()
        return response.json()

    def get_one(
        self,
        resource: str,
        *,
        select: str = "*",
        filters: dict[str, str] | None = None,
        order: str | None = None,
        use_service_role: bool = True,
    ) -> dict[str, Any] | None:
        rows = self.select(
            resource,
            select=select,
            filters=filters,
            order=order,
            limit=1,
            use_service_role=use_service_role,
        )
        return rows[0] if rows else None

    def insert(self, resource: str, payload: dict[str, Any], *, use_service_role: bool = True) -> dict[str, Any]:
        response = requests.post(
            self._endpoint(resource),
            headers={**self._headers(use_service_role=use_service_role), "Prefer": "return=representation"},
            json=payload,
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        return data[0] if isinstance(data, list) else data

    def bulk_insert(
        self,
        resource: str,
        payload: list[dict[str, Any]],
        *,
        use_service_role: bool = True,
    ) -> list[dict[str, Any]]:
        response = requests.post(
            self._endpoint(resource),
            headers={**self._headers(use_service_role=use_service_role), "Prefer": "return=representation"},
            json=payload,
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, list) else [data]

    def update(
        self,
        resource: str,
        filters: dict[str, str],
        payload: dict[str, Any],
        *,
        use_service_role: bool = True,
    ) -> dict[str, Any]:
        response = requests.patch(
            f"{self._endpoint(resource)}?{urlencode(filters)}",
            headers={**self._headers(use_service_role=use_service_role), "Prefer": "return=representation"},
            json=payload,
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        return data[0] if isinstance(data, list) and data else {}

    def bulk_update(
        self,
        resource: str,
        filters: dict[str, str],
        payload: dict[str, Any],
        *,
        use_service_role: bool = True,
    ) -> list[dict[str, Any]]:
        response = requests.patch(
            f"{self._endpoint(resource)}?{urlencode(filters)}",
            headers={**self._headers(use_service_role=use_service_role), "Prefer": "return=representation"},
            json=payload,
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, list) else [data]

    def delete(self, resource: str, filters: dict[str, str], *, use_service_role: bool = True) -> list[dict[str, Any]]:
        response = requests.delete(
            f"{self._endpoint(resource)}?{urlencode(filters)}",
            headers={**self._headers(use_service_role=use_service_role), "Prefer": "return=representation"},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, list) else [data]

    def admin_headers(self) -> dict[str, str]:
        return {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
            "Content-Type": "application/json",
        }

    def upload_binary(
        self,
        *,
        bucket: str,
        path: str,
        content: bytes,
        content_type: str,
    ) -> dict[str, Any]:
        response = requests.post(
            f"{self.base_url}/storage/v1/object/{bucket}/{path}",
            headers={
                **self.admin_headers(),
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            data=content,
            timeout=120,
        )
        response.raise_for_status()
        return response.json()

    def create_signed_url(self, *, bucket: str, path: str, expires_in: int) -> str:
        response = requests.post(
            f"{self.base_url}/storage/v1/object/sign/{bucket}/{path}",
            headers=self.admin_headers(),
            json={"expiresIn": expires_in},
            timeout=30,
        )
        response.raise_for_status()
        signed_path = response.json().get("signedURL", "")
        return f"{self.base_url}/storage/v1{signed_path}" if signed_path else ""
