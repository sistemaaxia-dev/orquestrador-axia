import os
import sys
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = BASE_DIR / "backend"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Force production-friendly defaults on Vercel.
os.environ.setdefault("FLASK_DEBUG", "false")

from app import create_app  # noqa: E402


app = create_app()
