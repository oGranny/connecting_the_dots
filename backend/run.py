import os
from app import create_app

app = create_app()

if __name__ == "__main__":
    host = os.getenv("BACKEND_HOST", "0.0.0.0")
    port = int(os.getenv("BACKEND_PORT", "4000"))  # <- 4000, not 3000
    debug = os.getenv("FLASK_DEBUG", "1") != "0"

    app.run(host=host, port=port, debug=debug)
