import os
import glob
from flask import Blueprint, request, jsonify, send_from_directory, current_app
from ..config import Config
from ..services.pdf_service import save_pdf
from ..services.rag_service import index_async

bp = Blueprint("uploads", __name__)

@bp.post("/api/upload")
def upload():
    saved_paths = []
    if "file" in request.files:
        file = request.files["file"]
        meta = save_pdf(file)
        saved_paths.append(os.path.join(Config.UPLOAD_DIR, meta["id"]))
        index_async(saved_paths)
        return jsonify(meta)

    files = request.files.getlist("files[]")
    if not files:
        return jsonify({"error": "No file(s) provided"}), 400

    metas = []
    for f in files:
        m = save_pdf(f)
        metas.append(m)
        saved_paths.append(os.path.join(Config.UPLOAD_DIR, m["id"]))

    index_async(saved_paths)
    return jsonify({"files": metas})
    
@bp.get("/api/files")
def list_files():
    items = []
    for name in os.listdir(Config.UPLOAD_DIR):
        path = os.path.join(Config.UPLOAD_DIR, name)
        if not os.path.isfile(path):
            continue
        items.append({
            "id": name,
            "name": name.split("_", 1)[-1],
            "size": os.path.getsize(path),
            "url": f"/uploads/{name}",
            "mimetype": "application/pdf",
        })
    return jsonify(items)

@bp.get("/uploads/<path:filename>")
def serve_upload(filename):
    resp = send_from_directory(Config.UPLOAD_DIR, filename, mimetype="application/pdf")
    origin = current_app.config["FRONTEND_ORIGIN"]
    resp.headers["Access-Control-Allow-Origin"] = origin if origin != "*" else "*"
    resp.headers["Accept-Ranges"] = "bytes"
    resp.headers["Cache-Control"] = "no-store"
    return resp
