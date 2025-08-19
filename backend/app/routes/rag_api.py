import glob
import os
from flask import Blueprint, jsonify, request
from ..config import Config
from ..services.rag_service import rag, index_async

bp = Blueprint("rag_api", __name__)

@bp.get("/api/rag/status")
def rag_status():
    v_rows = int(0 if rag.V is None else rag.V.shape[0])
    meta_rows = int(len(rag.metas) if hasattr(rag, "metas") and rag.metas is not None else 0)
    return jsonify({
        "chunks": v_rows,
        "metas": meta_rows,
        "mismatch": (v_rows != meta_rows),
        "dim": Config.EMBED_DIM,
        "isIndexing": rag.is_indexing,
        "lastUpdated": rag.last_updated,
        "embedModel": Config.EMBED_MODEL,
        "genModel": Config.GEN_MODEL,
    })

@bp.post("/api/rag/index")
def rag_index_now():
    index_async(sorted(glob.glob(os.path.join(Config.UPLOAD_DIR, "*.pdf"))))
    return jsonify({"ok": True})

@bp.post("/api/rag/query")
def rag_query():
    data = request.get_json(force=True, silent=True) or {}
    q = (data.get("q") or "").strip()
    top_k = int(data.get("top_k", Config.TOP_K_DEFAULT))
    if not q:
        return jsonify({"error": "Provide 'q'"}), 400
    try:
        resp = rag.answer(q, top_k)
        
        # Validate that we have a meaningful answer
        answer = (resp.get("answer") or "").strip()
        if not answer:
            # Fallback response when LLM gives empty answer
            contexts = resp.get("contexts", [])
            if contexts:
                resp["answer"] = f"I found {len(contexts)} relevant sections related to your query. Please check the context sources below for detailed information."
            else:
                resp["answer"] = "I couldn't find relevant information in the uploaded documents for your query."
        
        resp["_meta"] = {
            "isIndexing": rag.is_indexing,
            "chunks": int(0 if rag.V is None else rag.V.shape[0]),
        }
        print(f"Query: {q[:50]}... | Answer length: {len(resp.get('answer', ''))}")
        return jsonify(resp)
    except Exception as e:
        print(f"RAG query failed: {str(e)}")
        return jsonify({"error": "rag-failed", "detail": str(e)}), 500
