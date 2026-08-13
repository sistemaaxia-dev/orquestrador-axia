from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import requests
from flask import current_app


class SupabaseService:
    def __init__(self) -> None:
        self.base_url = current_app.config["SUPABASE_URL"].rstrip("/")
        self.schema = current_app.config["SUPABASE_SCHEMA"]
        self.api_key = current_app.config["SUPABASE_SERVICE_ROLE_KEY"] or current_app.config["SUPABASE_ANON_KEY"]

    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self.api_key,
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept-Profile": self.schema,
            "Content-Profile": self.schema,
        }

    def _endpoint(self, table: str) -> str:
        return f"{self.base_url}/rest/v1/{table}"

    def select(
        self,
        table: str,
        *,
        select: str = "*",
        filters: dict[str, str] | None = None,
        order: str | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, str] = {"select": select}
        if filters:
            params.update(filters)
        if order:
            params["order"] = order

        response = requests.get(
            f"{self._endpoint(table)}?{urlencode(params)}",
            headers=self._headers(),
            timeout=20,
        )
        response.raise_for_status()
        return response.json()

    def insert(self, table: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = requests.post(
            self._endpoint(table),
            headers={**self._headers(), "Prefer": "return=representation"},
            json=payload,
            timeout=20,
        )
        response.raise_for_status()
        data = response.json()
        return data[0] if isinstance(data, list) else data

    def update(self, table: str, filters: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
        query = urlencode(filters)
        response = requests.patch(
            f"{self._endpoint(table)}?{query}",
            headers={**self._headers(), "Prefer": "return=representation"},
            json=payload,
            timeout=20,
        )
        response.raise_for_status()
        data = response.json()
        return data[0] if isinstance(data, list) and data else {}

    def upsert(self, table: str, payload: dict[str, Any], *, on_conflict: str | None = None) -> dict[str, Any]:
        endpoint = self._endpoint(table)
        if on_conflict:
            endpoint = f"{endpoint}?{urlencode({'on_conflict': on_conflict})}"

        response = requests.post(
            endpoint,
            headers={**self._headers(), "Prefer": "resolution=merge-duplicates,return=representation"},
            json=payload,
            timeout=20,
        )
        response.raise_for_status()
        data = response.json()
        return data[0] if isinstance(data, list) and data else {}
