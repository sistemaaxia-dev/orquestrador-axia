from __future__ import annotations

import os
import smtplib
from base64 import b64encode
from email.message import EmailMessage
from typing import Iterable

import requests
from flask import current_app


class EmailService:
    def __init__(self) -> None:
        self.host = current_app.config["SMTP_HOST"]
        self.port = current_app.config["SMTP_PORT"]
        self.username = current_app.config["SMTP_USERNAME"]
        self.password = current_app.config["SMTP_PASSWORD"]
        self.from_email = current_app.config["SMTP_FROM_EMAIL"]
        self.from_name = current_app.config["SMTP_FROM_NAME"]
        self.use_tls = current_app.config["SMTP_USE_TLS"]
        self.redirect_to = current_app.config["SMTP_REDIRECT_TO"]
        self.attachment_to = current_app.config["SMTP_ATTACHMENT_TO"]
        self.integration_to = os.getenv("SMTP_INTEGRATION_TO", "") or self.attachment_to
        self.provider = current_app.config["EMAIL_PROVIDER"]
        self.resend_api_key = current_app.config["RESEND_API_KEY"]
        self.resend_from_email = current_app.config["RESEND_FROM_EMAIL"]

    def send_email(
        self,
        *,
        to_email: str,
        subject: str,
        text: str,
        attachments: Iterable[tuple[str, bytes, str]] = (),
        use_redirect: bool = True,
    ) -> None:
        recipient = self.redirect_to if use_redirect and self.redirect_to else to_email
        attachment_rows = list(attachments)
        if self.provider == "resend":
            self._send_via_resend(recipient, subject, text, attachment_rows)
            return

        if not self.host or not self.from_email:
            raise RuntimeError("Servico de e-mail nao configurado.")

        message = EmailMessage()
        message["From"] = f"{self.from_name} <{self.from_email}>"
        message["To"] = recipient
        message["Subject"] = subject
        message.set_content(text)
        for file_name, content, content_type in attachment_rows:
            main_type, _, sub_type = content_type.partition("/")
            message.add_attachment(
                content,
                maintype=main_type or "application",
                subtype=sub_type or "octet-stream",
                filename=file_name,
            )

        with smtplib.SMTP(self.host, self.port, timeout=30) as smtp:
            if self.use_tls:
                smtp.starttls()
            if self.username:
                smtp.login(self.username, self.password)
            smtp.send_message(message)

    def _send_via_resend(
        self,
        recipient: str,
        subject: str,
        text: str,
        attachments: list[tuple[str, bytes, str]],
    ) -> None:
        if not self.resend_api_key or not self.resend_from_email:
            raise RuntimeError("Resend nao configurado.")
        payload: dict[str, object] = {
            "from": self.resend_from_email,
            "to": [recipient],
            "subject": subject,
            "text": text,
        }
        if attachments:
            payload["attachments"] = [
                {
                    "filename": file_name,
                    "content": b64encode(content).decode("ascii"),
                    "content_type": content_type,
                }
                for file_name, content, content_type in attachments
            ]
        response = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {self.resend_api_key}"},
            json=payload,
            timeout=30,
        )
        if not response.ok:
            raise RuntimeError(f"Resend recusou o envio: {response.text}")
