from flask import Flask
from flask_cors import CORS

from .config import Config
from .routes.activities import activities_bp
from .routes.health import health_bp
from .routes.logs import logs_bp
from .routes.users import users_bp
from .routes.workflows import workflows_bp


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)

    CORS(
        app,
        resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
        supports_credentials=True,
    )

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(workflows_bp, url_prefix="/api")
    app.register_blueprint(activities_bp, url_prefix="/api")
    app.register_blueprint(logs_bp, url_prefix="/api")
    app.register_blueprint(users_bp, url_prefix="/api")

    return app
