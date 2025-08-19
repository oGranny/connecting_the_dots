import os
import glob
from flask import Blueprint, request, jsonify, send_from_directory, current_app
from ..config import Config
from ..services.pdf_service import save_pdf
from ..services.rag_service import index_async
from ..services.rag_service import index_async, rag

bp = Blueprint("uploads", __name__)

@bp.delete("/api/files/<file_id>")
def delete_file(file_id):
    """
    Deletes the uploaded PDF from disk and removes all of its chunks/vectors
    from the RAG index. Frontend can call this when the viewer closes.
    """
    path = os.path.join(Config.UPLOAD_DIR, file_id)
    if not os.path.isfile(path):
        return jsonify({"ok": False, "error": "File not found"}), 404

    # Purge from RAG first (so searches can't hit a soon-to-be-missing path)
    rag.remove_pdfs([path])

    # Then delete from disk
    try:
        os.remove(path)
    except Exception as ex:
        # Best-effort: the index is already clean; report the FS failure
        return jsonify({"ok": False, "error": f"Failed to delete file: {ex}"}), 500

    return jsonify({"ok": True, "deleted": file_id})

@bp.post("/api/files/delete")
def delete_files_batch():
    """
    Batch delete: body { "ids": ["<id1>", "<id2>", ...] }
    """
    data = request.get_json(silent=True) or {}
    ids = data.get("ids") or []
    if not isinstance(ids, list) or not ids:
        return jsonify({"ok": False, "error": "Provide a non-empty 'ids' array"}), 400

    paths = []
    missing = []
    for fid in ids:
        p = os.path.join(Config.UPLOAD_DIR, fid)
        if os.path.isfile(p):
            paths.append(p)
        else:
            missing.append(fid)

    # Purge from RAG
    rag.remove_pdfs(paths)

    # Delete files from disk
    failed = []
    for p in paths:
        try:
            os.remove(p)
        except Exception as ex:
            failed.append({"id": os.path.basename(p), "error": str(ex)})

    return jsonify({
        "ok": len(failed) == 0,
        "deleted": [os.path.basename(p) for p in paths if os.path.basename(p) not in {f["id"] for f in failed}],
        "missing": missing,
        "failed": failed
    })

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
