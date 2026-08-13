import os
from dotenv import load_dotenv


load_dotenv()


class Config:
    FLASK_DEBUG = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    APP_HOST = os.getenv("APP_HOST", "127.0.0.1")
    APP_PORT = int(os.getenv("APP_PORT", "5000"))
    CORS_ORIGINS = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://127.0.0.1:4173,http://localhost:4173").split(",")]

    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    SUPABASE_SCHEMA = os.getenv("SUPABASE_SCHEMA", "public")

    SHAREPOINT_TENANT_ID = os.getenv("SHAREPOINT_TENANT_ID", "")
    SHAREPOINT_CLIENT_ID = os.getenv("SHAREPOINT_CLIENT_ID", "")
    SHAREPOINT_CLIENT_SECRET = os.getenv("SHAREPOINT_CLIENT_SECRET", "")
    SHAREPOINT_HOSTNAME = os.getenv("SHAREPOINT_HOSTNAME", "")
    SHAREPOINT_SITE_PATH = os.getenv("SHAREPOINT_SITE_PATH", "")
    SHAREPOINT_DOCUMENT_LIBRARY = os.getenv("SHAREPOINT_DOCUMENT_LIBRARY", "")
    SHAREPOINT_UPLOAD_FOLDER = os.getenv("SHAREPOINT_UPLOAD_FOLDER", "orquestrador-anexos")
