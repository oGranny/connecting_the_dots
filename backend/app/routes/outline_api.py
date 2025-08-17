import os
from flask import Blueprint, request, jsonify
from ..config import Config
from outline_yolo import build_outline_for_file  # your existing module

bp = Blueprint("outline_api", __name__)

@bp.post("/api/outline-yolo")
def outline_yolo():
    data = request.get_json(force=True, silent=True) or {}
    file_id = data.get("id")
    if not file_id:
        return jsonify({"error": "bad-request", "detail": "Provide uploaded file 'id'"}), 400

    pdf_path = os.path.join(Config.UPLOAD_DIR, file_id)
    if not os.path.exists(pdf_path):
        return jsonify({"error": "file-not-found", "detail": f"PDF not found: {pdf_path}"}), 404

    if not os.path.exists(Config.YOLO_MODEL):
        return jsonify({
            "error": "model-missing",
            "detail": f"YOLO model not found at {os.path.abspath(Config.YOLO_MODEL)}. "
                      f"Put model.pt there or set YOLO_MODEL env var."
        }), 500

    try:
        out = build_outline_for_file(pdf_path, model_path=Config.YOLO_MODEL, dpi=200)
        return jsonify(out)
    except Exception as e:
        return jsonify({"error": "outline-failed", "detail": str(e)}), 500
