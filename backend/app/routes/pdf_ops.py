from flask import Blueprint, request, jsonify
from ..services.pdf_service import open_doc, extract_headings, search_pdf

bp = Blueprint("pdf_ops", __name__)

@bp.post("/api/headings")
def headings():
    data = request.get_json(force=True, silent=True) or {}
    file_id = data.get("id")
    if not file_id:
        return jsonify({"error": "Provide uploaded file 'id'"}), 400
    try:
        doc, _ = open_doc(file_id)
        hs = extract_headings(doc)
        return jsonify({"headings": hs})
    except FileNotFoundError:
        return jsonify({"error": "File not found"}), 404
    except Exception as e:
        return jsonify({"error": "failed", "detail": str(e)}), 500

@bp.post("/api/search")
def search():
    data = request.get_json(force=True, silent=True) or {}
    file_id = data.get("id")
    query = data.get("query", "")
    limit = int(data.get("limit", 10))
    if not file_id or not query:
        return jsonify({"error": "Provide 'id' and 'query'"}), 400
    try:
        doc, _ = open_doc(file_id)
        hits = search_pdf(doc, query, limit=limit)
        return jsonify({"results": hits})
    except FileNotFoundError:
        return jsonify({"error": "File not found"}), 404
    except Exception as e:
        return jsonify({"error": "failed", "detail": str(e)}), 500
