import glob
import os
from flask import Blueprint, jsonify, request
from ..config import Config
from ..services.rag_service import rag, index_async, top_snippets_async, hybrid_answer

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

@bp.post("/api/rag/query-hybrid")
def rag_query_hybrid():
    """
    Hybrid query:
      - if rank1 score >= CHAT_CONF_THRESHOLD -> normal RAG answer
      - else -> LLM over precomputed top snippets (sidecars)
    Params:
      q (str)                   : required
      top_k (int, optional)     : default Config.TOP_K_DEFAULT
      conf_threshold (float)    : optional override; else env/Config
      max_snippets_total (int)  : optional; default 12
      max_snippets_per_pdf (int): optional; default 5
    """
    data = request.get_json(force=True, silent=True) or {}
    q = (data.get("q") or "").strip()
    if not q:
        return jsonify({"error": "Provide 'q'"}), 400

    top_k = int(data.get("top_k", Config.TOP_K_DEFAULT))
    conf_threshold = data.get("conf_threshold", None)
    max_snips_total = data.get("max_snippets_total", 12)
    max_snips_per_pdf = data.get("max_snippets_per_pdf", 5)

    try:
        resp = hybrid_answer(
            query=q,
            top_k=top_k,
            conf_threshold=conf_threshold,
            max_snippets_total=max_snips_total,
            max_snippets_per_pdf=max_snips_per_pdf,
        )
        # safety: never send empty answer
        if not (resp.get("answer") or "").strip():
            resp["answer"] = "I couldn't produce an answer from the documents."
        return jsonify(resp)
    except Exception as e:
        print(f"Hybrid query failed: {e}")
        return jsonify({"error": "rag-hybrid-failed", "detail": str(e)}), 500

@bp.get("/api/rag/snippets/<file_id>")
def rag_get_snippets_sidecar(file_id):
    """
    Returns the top-snippets sidecar JSON for a given uploaded file id.
    """
    sc = os.path.join(Config.UPLOAD_DIR, f"{file_id}.topsnips.json")
    if not os.path.exists(sc):
        return jsonify({"error": "not-found"}), 404
    try:
        import json
        with open(sc, "r", encoding="utf-8") as f:
            data = json.load(f)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": "read-failed", "detail": str(e)}), 500

@bp.post("/api/rag/snippets/rebuild")
def rag_rebuild_snippets():
    """
    Body: { "ids": ["<file_id1>", ...], "k": 8 }
    Rebuilds the top-snippets sidecars asynchronously.
    """
    data = request.get_json(force=True, silent=True) or {}
    ids = data.get("ids") or []
    if not isinstance(ids, list) or not ids:
        return jsonify({"error": "Provide non-empty 'ids' array"}), 400
    k = data.get("k", None)

    paths = []
    for fid in ids:
        p = os.path.join(Config.UPLOAD_DIR, fid)
        if os.path.isfile(p):
            paths.append(p)

    if not paths:
        return jsonify({"error": "no-valid-files"}), 400

    top_snippets_async(paths, k)
    return jsonify({"ok": True, "queued": [os.path.basename(p) for p in paths]})
