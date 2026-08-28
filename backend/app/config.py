import os

from dotenv import load_dotenv


load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


class Config:
    FLASK_DEBUG = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    APP_HOST = os.getenv("APP_HOST", "127.0.0.1")
    APP_PORT = int(os.getenv("APP_PORT", "5000"))
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://127.0.0.1:5173")
    CORS_ORIGINS = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173",
        ).split(",")
        if origin.strip()
    ]

    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    SUPABASE_SCHEMA = os.getenv("SUPABASE_SCHEMA", "public")
    SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "workflow-attachments")
    SUPABASE_STORAGE_SIGNED_URL_TTL = int(os.getenv("SUPABASE_STORAGE_SIGNED_URL_TTL", "3600"))
    ATTACHMENT_PROVIDER = os.getenv("ATTACHMENT_PROVIDER", "supabase").lower()

    SMTP_HOST = os.getenv("SMTP_HOST", "")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", "")
    SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Projeto Axiom")
    SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
    SMTP_REDIRECT_TO = os.getenv("SMTP_REDIRECT_TO", "")
    SMTP_ATTACHMENT_TO = os.getenv("SMTP_ATTACHMENT_TO", "")
    EMAIL_PROVIDER = os.getenv("EMAIL_PROVIDER", "resend").lower()
    RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
    RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "")

    SHAREPOINT_TENANT_ID = os.getenv("SHAREPOINT_TENANT_ID", "")
    SHAREPOINT_CLIENT_ID = os.getenv("SHAREPOINT_CLIENT_ID", "")
    SHAREPOINT_CLIENT_SECRET = os.getenv("SHAREPOINT_CLIENT_SECRET", "")
    SHAREPOINT_HOSTNAME = os.getenv("SHAREPOINT_HOSTNAME", "")
    SHAREPOINT_SITE_PATH = os.getenv("SHAREPOINT_SITE_PATH", "")
    SHAREPOINT_DOCUMENT_LIBRARY = os.getenv("SHAREPOINT_DOCUMENT_LIBRARY", "")
    SHAREPOINT_UPLOAD_FOLDER = os.getenv("SHAREPOINT_UPLOAD_FOLDER", "orquestrador-anexos")
