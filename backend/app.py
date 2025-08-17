import os
import re
import uuid
from typing import List, Dict, Any, Tuple

import numpy as np
try:
    from sklearn.cluster import KMeans
    _HAS_SKLEARN = True
except Exception:
    _HAS_SKLEARN = False

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename
from outline_yolo import build_outline_for_file

import fitz  # PyMuPDF
from dotenv import load_dotenv

load_dotenv()
import os

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
YOLO_MODEL = os.getenv(
    "YOLO_MODEL",
    os.path.join(BACKEND_DIR, "model", "model.pt")
)
print("Using YOLO model at:", YOLO_MODEL)

# ----------------- Config -----------------
PORT = int(os.getenv("PORT", "4000"))
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "*")
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_MIME = {"application/pdf"}

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": [FRONTEND_ORIGIN, "*"]}}, supports_credentials=True)


# ----------------- Helpers -----------------
def _save_pdf(file_storage) -> Dict[str, Any]:
    if file_storage.mimetype not in ALLOWED_MIME:
        raise ValueError("Only PDF files are allowed")
    safe_name = secure_filename(file_storage.filename or "document.pdf")
    file_id = f"{uuid.uuid4().hex}_{safe_name}"
    path = os.path.join(UPLOAD_DIR, file_id)
    file_storage.save(path)
    return {
        "id": file_id,
        "name": file_storage.filename,
        "size": os.path.getsize(path),
        "url": f"/uploads/{file_id}",
        "mimetype": file_storage.mimetype,
    }


def _open_doc(file_id: str) -> Tuple[fitz.Document, str]:
    path = os.path.join(UPLOAD_DIR, file_id)
    if not os.path.exists(path):
        raise FileNotFoundError("File not found")
    return fitz.open(path), path


def _normalize_sizes(sizes: List[float], eps=0.6) -> List[float]:
    # cluster similar sizes (e.g., 16.02 and 16.4 -> 16.2)
    sizes = sorted(set(round(s, 1) for s in sizes), reverse=True)
    out = []
    for s in sizes:
        if not out or abs(out[-1] - s) > eps:
            out.append(s)
    return out


def _extract_headings(doc: fitz.Document, max_levels: int = 4) -> List[Dict[str, Any]]:
    """
    Heuristic: cluster font sizes into up to 4 groups and map:
      largest center -> H1, next -> H2, ...
    Returns [{id, level:int(1..4), title, page:int(1-based)}]
    """
    spans = []
    sizes = []

    for pno in range(len(doc)):
        page = doc[pno]
        d = page.get_text("dict")
        # pull y position too so we can sort correctly
        for block in d.get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = (span.get("text") or "").strip()
                    if not text:
                        continue
                    # very short noise
                    if len(text) < 2:
                        continue

                    size = float(span.get("size", 0))
                    # keep bbox top (y1)
                    bbox = span.get("bbox") or [0, 0, 0, 0]
                    y_top = float(bbox[1]) if isinstance(bbox, (list, tuple)) and len(bbox) >= 2 else 0.0
                    font = (span.get("font") or "").lower()

                    spans.append({
                        "page": pno + 1,   # 1-based
                        "text": text,
                        "size": size,
                        "y": y_top,
                        "font": font,
                    })
                    sizes.append(size)

    if not spans or not sizes:
        return []

    sizes_arr = np.array(sizes, dtype=np.float32)
    uniq = np.unique(np.round(sizes_arr, 2))
    # number of clusters to attempt (cap by max_levels)
    K = int(np.clip(len(uniq), 1, max_levels))

    # If everything is truly one size, we can't infer hierarchy -> all H1
    if K == 1:
        results = []
        seen_on_page = set()
        for s in sorted(spans, key=lambda x: (x["page"], x["y"])):
            title = re.sub(r"\s+", " ", s["text"]).strip()
            if not title:
                continue
            key = (s["page"], title.lower())
            if key in seen_on_page:
                continue
            seen_on_page.add(key)
            results.append({
                "id": uuid.uuid4().hex,
                "level": 1,
                "title": title if len(title) <= 140 else (title[:137] + "…"),
                "page": s["page"],
            })
        return results

    # Cluster sizes into K groups
    if _HAS_SKLEARN and K >= 2:
        km = KMeans(n_clusters=K, random_state=42, n_init=10)
        labels = km.fit_predict(sizes_arr.reshape(-1, 1))
        centers = km.cluster_centers_.ravel()
    else:
        # fallback: quantile binning
        qs = np.quantile(sizes_arr, np.linspace(0, 1, K + 1))
        labels = np.zeros_like(sizes_arr, dtype=int)
        for i, s in enumerate(sizes_arr):
            for b in range(K):
                if qs[b] <= s <= qs[b + 1]:
                    labels[i] = min(b, K - 1)
                    break
        centers = np.array([(sizes_arr[labels == b].mean() if np.any(labels == b) else 0.0) for b in range(K)])

    # largest center -> H1, next -> H2, ...
    order = np.argsort(centers)[::-1]  # indices of clusters from largest to smallest
    cluster_to_level = {int(order[i]): i + 1 for i in range(K)}  # 1..K

    # Build heading candidates, keep simple filters to reduce obvious body text:
    # - Prefer bold-ish fonts or anything in larger clusters
    # - Limit very long runs
    items = []
    for s, lab in zip(spans, labels):
        lvl = int(cluster_to_level.get(int(lab), 4))
        title = re.sub(r"\s+", " ", s["text"]).strip()
        if not title:
            continue
        # mild filtering: if it's in smallest cluster (likely body) AND not bold, skip
        if lvl >= min(K, 4) and "bold" not in s["font"]:
            # still keep if the size is in top half clusters
            if lvl > 2:
                continue

        items.append({
            "page": s["page"],
            "y": s["y"],
            "title": title if len(title) <= 140 else (title[:137] + "…"),
            "level": int(np.clip(lvl, 1, 4)),
        })

    if not items:
        return []

    # Sort by (page, vertical position)
    items.sort(key=lambda x: (x["page"], x["y"], x["level"]))

    # De-duplicate consecutive on the same page
    results = []
    seen_on_page = set()
    for it in items:
        key = (it["page"], it["title"].lower())
        if key in seen_on_page:
            continue
        seen_on_page.add(key)
        results.append({
            "id": uuid.uuid4().hex,
            "level": it["level"],
            "title": it["title"],
            "page": it["page"],
        })

    return results


def _search_pdf(doc: fitz.Document, query: str, limit: int = 10) -> List[Dict[str, Any]]:
    out = []
    q = query.strip()
    if not q:
        return out
    for pno in range(len(doc)):
        page = doc[pno]
        rects = page.search_for(q)
        if not rects:
            continue

        txt = page.get_text("text")
        i = txt.lower().find(q.lower())
        if i == -1:
            snippet = txt[:300].replace("\n", " ").strip()
        else:
            start = max(0, i - 150)
            snippet = txt[start: i + len(q) + 150].replace("\n", " ").strip()

        out.append({
            "page": pno + 1,
            "count": len(rects),
            "snippet": snippet,
        })
        if len(out) >= limit:
            break
    return out


# ----------------- Routes -----------------
@app.get("/api/health")
def health():
    return jsonify({"ok": True})


@app.post("/api/outline-yolo")
def outline_yolo():
    data = request.get_json(force=True, silent=True) or {}
    file_id = data.get("id")
    if not file_id:
        return jsonify({"error": "bad-request", "detail": "Provide uploaded file 'id'"}), 400

    pdf_path = os.path.join(UPLOAD_DIR, file_id)
    if not os.path.exists(pdf_path):
        return jsonify({"error": "file-not-found", "detail": f"PDF not found: {pdf_path}"}), 404

    # NEW: explicit model check with absolute path in error
    if not os.path.exists(YOLO_MODEL):
        return jsonify({
            "error": "model-missing",
            "detail": f"YOLO model not found at {os.path.abspath(YOLO_MODEL)}. "
                      f"Put model.pt there or set YOLO_MODEL env var."
        }), 500

    try:
        out = build_outline_for_file(pdf_path, model_path=YOLO_MODEL, dpi=200)
        return jsonify(out)
    except Exception as e:
        return jsonify({"error": "outline-failed", "detail": str(e)}), 500


@app.post("/api/upload")
def upload():
    if "file" in request.files:
        file = request.files["file"]
        meta = _save_pdf(file)
        return jsonify(meta)

    # also support multiple: files[]
    files = request.files.getlist("files[]")
    if not files:
        return jsonify({"error": "No file(s) provided"}), 400

    metas = [_save_pdf(f) for f in files]
    return jsonify({"files": metas})


@app.get("/api/files")
def list_files():
    items = []
    for name in os.listdir(UPLOAD_DIR):
        path = os.path.join(UPLOAD_DIR, name)
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


@app.get("/uploads/<path:filename>")
def serve_upload(filename):
    resp = send_from_directory(UPLOAD_DIR, filename, mimetype="application/pdf")
    origin = FRONTEND_ORIGIN if FRONTEND_ORIGIN != "*" else "*"
    resp.headers["Access-Control-Allow-Origin"] = origin
    resp.headers["Accept-Ranges"] = "bytes"
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.post("/api/headings")
def headings():
    """
    Returns headings in a flat, ordered list:
      { ok: true, data: [{id, level:1..4, title, page:1..N}, ...], headings: [...] }

    Source priority (explicit):
    - prefer="yolo"  -> run YOLO outline (can be slow)
    - prefer!="yolo" -> fast PyMuPDF heuristic fallback
    """
    data = request.get_json(force=True, silent=True) or {}
    file_id = data.get("id")
    prefer = (data.get("prefer") or "").strip().lower()  # "yolo" to force YOLO, anything else -> heuristic

    if not file_id:
        return jsonify({"ok": False, "error": "Provide uploaded file 'id'"}), 400

    try:
        doc, pdf_path = _open_doc(file_id)

        items = []

        # Choose source explicitly
        if prefer == "yolo" and os.path.exists(YOLO_MODEL):
            try:
                yolo_out = build_outline_for_file(pdf_path, model_path=YOLO_MODEL, dpi=200) or {}
                # expecting {"title": "...", "outline": [{"level": "H2"/2, "text"/"title": "...", "page": 0-based}, ...]}
                items = list(yolo_out.get("outline") or [])
            except Exception:
                # if YOLO fails, fallback to heuristic immediately
                items = []

        if not items:
            # Fast heuristic (PyMuPDF): [{id, level:int, title, page:1..N}]
            hs = _extract_headings(doc)
            # adapt to uniform normalization below (temporarily make page 0-based)
            items = [{"level": h["level"], "title": h["title"], "page": h["page"] - 1} for h in hs]

        # --- keep incoming order; normalize to {id, level:1..4, title, page:1..N} ---
        norm = []
        seen = set()
        for it in items:
            title = (it.get("title") or it.get("text") or it.get("name") or "").strip()
            if not title:
                continue

            raw_page = it.get("page") or it.get("page_num") or it.get("p") or 0
            try:
                page0 = int(raw_page)
            except Exception:
                page0 = 0
            page = max(1, page0 + 1)  # convert 0-based -> 1-based

            lv_raw = it.get("level") or it.get("depth") or it.get("h_level") or it.get("tag") or 1
            if isinstance(lv_raw, str):
                s = lv_raw.strip().lower()
                if s.startswith("h") and s[1:].isdigit():
                    lvl = int(s[1:])
                else:
                    try:
                        lvl = int(s)
                    except Exception:
                        lvl = 1
            else:
                try:
                    lvl = int(lv_raw)
                except Exception:
                    lvl = 1

            # clamp to H1..H4 so the UI can indent consistently
            lvl = max(1, min(4, lvl))

            key = (page, lvl, title.lower())
            if key in seen:
                continue
            seen.add(key)

            norm.append({
                "id": uuid.uuid4().hex,
                "level": lvl,
                "title": title,
                "page": page,
            })

        # Return both "data" and "headings" (compat with older client code)
        return jsonify({"ok": True, "data": norm, "headings": norm})
    except FileNotFoundError:
        return jsonify({"ok": False, "error": "File not found"}), 404
    except Exception as e:
        return jsonify({"ok": False, "error": "failed", "detail": str(e)}), 500


@app.post("/api/search")
def search():
    data = request.get_json(force=True, silent=True) or {}
    file_id = data.get("id")
    query = data.get("query", "")
    limit = int(data.get("limit", 10))
    if not file_id or not query:
        return jsonify({"error": "Provide 'id' and 'query'"}), 400

    try:
        doc, _ = _open_doc(file_id)
        hits = _search_pdf(doc, query, limit=limit)
        return jsonify({"results": hits})
    except FileNotFoundError:
        return jsonify({"error": "File not found"}), 404
    except Exception as e:
        return jsonify({"error": "failed", "detail": str(e)}), 500


@app.post("/api/analyze")
def analyze():
    """
    Stub that returns shape the UI expects:
      - insights (title, body)
      - facts (text)
      - connections (text, jump:{page})
      - related (docName, page, title, snippet)
    """
    data = request.get_json(force=True, silent=True) or {}
    persona = data.get("persona", "Student")
    jtbd = data.get("jtbd", "Study key concepts")
    ids = data.get("ids", [])

    insights = [
        {"id": uuid.uuid4().hex, "title": "Separate kinetics from thermodynamics",
         "body": "Focus on rate laws and mechanisms; thermodynamics explains feasibility, not speed."},
        {"id": uuid.uuid4().hex, "title": "Temperature sensitivity",
         "body": "Arrhenius shows exponential dependence of rate on temperature; log form linearizes for plotting."}
    ]
    facts = [
        {"id": uuid.uuid4().hex, "text": "Catalysts change pathway, not ΔG; equilibrium position remains unchanged."},
        {"id": uuid.uuid4().hex, "text": "Pseudo-first-order: treat one reactant concentration as constant when in excess."},
    ]
    connections = [
        {"id": uuid.uuid4().hex, "text": "Observed rate law aligns with slow (rate-determining) elementary step.",
         "jump": {"page": 6}}
    ]

    related = []
    for fid in ids[:1]:
        try:
            _, _ = _open_doc(fid)
            name = fid.split("_", 1)[-1]
            related.extend([
                {"id": uuid.uuid4().hex, "docName": name, "page": 2, "title": "Rate Laws",
                 "snippet": "The rate of a reaction depends on concentrations raised to reaction orders…"},
                {"id": uuid.uuid4().hex, "docName": name, "page": 4, "title": "Arrhenius Equation",
                 "snippet": "k = A·e^(−Ea/RT). Linear form: ln k = ln A − Ea/RT…"},
            ])
        except Exception:
            pass

    return jsonify({
        "persona": persona, "jtbd": jtbd,
        "insights": insights, "facts": facts, "connections": connections, "related": related
    })


@app.post("/api/podcast")
def podcast():
    """
    Returns a simple script for 2–5 minute narration (UI can TTS it or stream later).
    """
    data = request.get_json(force=True, silent=True) or {}
    topic = data.get("topic", "Reaction Kinetics")
    length = data.get("length", "3 min")

    script = (
        f"Welcome to a quick micro-podcast on {topic}. "
        "We’ll start with why kinetics matters: it tells you how fast reactions proceed… "
        "Next, rate laws: identify orders experimentally using method of initial rates… "
        "Then the Arrhenius equation: temperature changes can dramatically affect rate constants… "
        "Finally, mechanisms: the slow step governs the observed rate law. "
        "That’s your crash course! Good luck with your prep."
    )
    return jsonify({"topic": topic, "length": length, "script": script, "audio_url": None})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=True)