import os
from flask import Flask
from flask_cors import CORS
from .config import Config

def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)

    # CORS
    CORS(app, resources={r"/api/*": {"origins": [app.config["FRONTEND_ORIGIN"], "*"]}},
         supports_credentials=True)

    # Ensure dirs
    os.makedirs(app.config["UPLOAD_DIR"], exist_ok=True)
    os.makedirs(app.config["RAG_DIR"], exist_ok=True)

    # Register blueprints
    from .routes.health import bp as health_bp
    from .routes.uploads import bp as uploads_bp
    from .routes.pdf_ops import bp as pdf_ops_bp
    from .routes.outline_api import bp as outline_bp
    from .routes.rag_api import bp as rag_bp
    from .routes.podcast_api import bp as podcast_bp
    from .routes.analyze_api import bp as analyze_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(uploads_bp)
    app.register_blueprint(pdf_ops_bp)
    app.register_blueprint(outline_bp)
    app.register_blueprint(rag_bp)
    app.register_blueprint(podcast_bp)
    app.register_blueprint(analyze_bp)

    return app
