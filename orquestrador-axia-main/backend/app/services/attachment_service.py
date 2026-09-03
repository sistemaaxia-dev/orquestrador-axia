from __future__ import annotations

from io import BytesIO
from uuid import uuid4

from flask import current_app
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from .sharepoint_service import SharePointService
from .supabase_service import SupabaseService


class AttachmentService:
    def __init__(self) -> None:
        self.provider = current_app.config["ATTACHMENT_PROVIDER"]
        self.bucket = current_app.config["SUPABASE_STORAGE_BUCKET"]
        self.signed_url_ttl = current_app.config["SUPABASE_STORAGE_SIGNED_URL_TTL"]
        self.supabase = SupabaseService()

    def upload_activity_attachment(
        self,
        *,
        workflow_id: str,
        workflow_name: str,
        activity_id: str,
        activity_name: str,
        file: FileStorage,
    ) -> dict[str, str]:
        if self.provider == "sharepoint":
            uploaded = SharePointService().upload_activity_attachment(
                workflow_name=workflow_name,
                activity_name=activity_name,
                file=file,
            )
            return {
                "provider": "sharepoint",
                "file_name": uploaded["file_name"],
                "file_url": uploaded["file_url"],
                "external_id": uploaded["sharepoint_item_id"],
                "storage_path": "",
            }

        safe_name = secure_filename(file.filename or "anexo.bin")
        storage_path = f"{workflow_id}/{activity_id}/{uuid4().hex}-{safe_name}"
        content = BytesIO(file.read()).getvalue()
        self.supabase.upload_binary(
            bucket=self.bucket,
            path=storage_path,
            content=content,
            content_type=file.mimetype or "application/octet-stream",
        )
        return {
            "provider": "supabase_storage",
            "file_name": safe_name,
            "file_url": self.supabase.create_signed_url(
                bucket=self.bucket,
                path=storage_path,
                expires_in=self.signed_url_ttl,
            ),
            "external_id": "",
            "storage_path": storage_path,
        }
