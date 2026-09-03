from __future__ import annotations

from io import BytesIO
from typing import Any

import msal
import requests
from flask import current_app
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename


class SharePointService:
    graph_base = "https://graph.microsoft.com/v1.0"

    def __init__(self) -> None:
        self.tenant_id = current_app.config["SHAREPOINT_TENANT_ID"]
        self.client_id = current_app.config["SHAREPOINT_CLIENT_ID"]
        self.client_secret = current_app.config["SHAREPOINT_CLIENT_SECRET"]
        self.hostname = current_app.config["SHAREPOINT_HOSTNAME"]
        self.site_path = current_app.config["SHAREPOINT_SITE_PATH"]
        self.library = current_app.config["SHAREPOINT_DOCUMENT_LIBRARY"]
        self.upload_folder = current_app.config["SHAREPOINT_UPLOAD_FOLDER"]
        self._validate_config()

    def _validate_config(self) -> None:
        missing = []
        required_fields = {
            "SHAREPOINT_TENANT_ID": self.tenant_id,
            "SHAREPOINT_CLIENT_ID": self.client_id,
            "SHAREPOINT_CLIENT_SECRET": self.client_secret,
            "SHAREPOINT_HOSTNAME": self.hostname,
            "SHAREPOINT_SITE_PATH": self.site_path,
            "SHAREPOINT_DOCUMENT_LIBRARY": self.library,
        }

        for field_name, field_value in required_fields.items():
            if not field_value:
                missing.append(field_name)

        if missing:
            raise RuntimeError(
                "Integracao SharePoint nao configurada. Preencha: "
                + ", ".join(missing)
            )

    def _token(self) -> str:
        authority = f"https://login.microsoftonline.com/{self.tenant_id}"
        app = msal.ConfidentialClientApplication(
            client_id=self.client_id,
            client_credential=self.client_secret,
            authority=authority,
        )
        result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
        if "access_token" not in result:
            detail = result.get("error_description") or result.get("error") or "erro desconhecido"
            raise RuntimeError(f"Nao foi possivel obter token do Microsoft Graph. Detalhe: {detail}")
        return result["access_token"]

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token()}"}

    def _site_id(self) -> str:
        response = requests.get(
            f"{self.graph_base}/sites/{self.hostname}:{self.site_path}",
            headers=self._headers(),
            timeout=20,
        )
        response.raise_for_status()
        return response.json()["id"]

    def _drive_id(self, site_id: str) -> str:
        response = requests.get(
            f"{self.graph_base}/sites/{site_id}/drives",
            headers=self._headers(),
            timeout=20,
        )
        response.raise_for_status()
        drives: list[dict[str, Any]] = response.json().get("value", [])
        drive = next((item for item in drives if item.get("name") == self.library), None)
        if not drive:
            raise RuntimeError(f"Biblioteca '{self.library}' nao encontrada no SharePoint.")
        return drive["id"]

    def upload_activity_attachment(self, workflow_name: str, activity_name: str, file: FileStorage) -> dict[str, str]:
        safe_name = secure_filename(file.filename or "anexo.bin")
        site_id = self._site_id()
        drive_id = self._drive_id(site_id)
        folder = f"{self.upload_folder}/{secure_filename(workflow_name)}/{secure_filename(activity_name)}"
        upload_url = f"{self.graph_base}/drives/{drive_id}/root:/{folder}/{safe_name}:/content"

        buffer = BytesIO(file.read())
        response = requests.put(
            upload_url,
            headers={
                **self._headers(),
                "Content-Type": file.mimetype or "application/octet-stream",
            },
            data=buffer.getvalue(),
            timeout=120,
        )
        response.raise_for_status()
        payload = response.json()

        return {
            "file_name": payload.get("name", safe_name),
            "file_url": payload.get("webUrl", ""),
            "sharepoint_item_id": payload.get("id", ""),
        }
