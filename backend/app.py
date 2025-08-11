import os
import re
import uuid
from typing import List, Dict, Any, Tuple

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename
from outline_yolo import build_outline_for_file

import fitz  # PyMuPDF
from dotenv import load_dotenv

load_dotenv()
YOLO_MODEL = os.getenv("YOLO_MODEL", os.path.join(os.path.dirname(__file__), "model", "model.pt"))

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


def _extract_headings(doc: fitz.Document, max_levels: int = 3) -> List[Dict[str, Any]]:
    """Heuristic 1A: pick the top font sizes in the document as H1/H2/H3."""
    spans = []
    all_sizes = []
    for pno in range(len(doc)):
        page = doc[pno]
        d = page.get_text("dict")
        for block in d.get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = (span.get("text") or "").strip()
                    if not text:
                        continue
                    # skip page headers/footers and noise
                    if len(text) < 3:
                        continue
                    size = float(span.get("size", 0))
                    all_sizes.append(size)
                    spans.append({
                        "page": pno + 1,  # 1-based
                        "text": text,
                        "size": size,
                        "bbox": span.get("bbox"),
                        "font": span.get("font"),
                    })

    if not spans:
        return []

    top_sizes = _normalize_sizes(all_sizes)
    levels = top_sizes[:max_levels]  # biggest -> H1, next -> H2, etc.
    results = []
    for s in spans:
        try:
            level = levels.index(min(levels, key=lambda L: abs(L - s["size"]))) + 1
        except ValueError:
            continue
        # only accept if this span is really larger than body text
        if s["size"] < levels[min(len(levels) - 1, 2)] - 0.2 and level > 2:
            continue
        # trim title-ish strings
        title = re.sub(r"\s+", " ", s["text"]).strip()
        if len(title) > 140:
            title = title[:137] + "…"
        results.append({
            "id": uuid.uuid4().hex,
            "level": level,
            "title": title,
            "page": s["page"],
        })

    # de-duplicate consecutive repeats
    deduped = []
    seen_on_page = set()
    for h in results:
        key = (h["page"], h["title"].lower())
        if key in seen_on_page:
            continue
        deduped.append(h)
        seen_on_page.add(key)
    # prefer order by page then (roughly) by level/title
    deduped.sort(key=lambda x: (x["page"], x["level"]))
    return deduped


def _search_pdf(doc: fitz.Document, query: str, limit: int = 10) -> List[Dict[str, Any]]:
    out = []
    q = query.strip()
    if not q:
        return out
    for pno in range(len(doc)):
        page = doc[pno]
        # rects = page.search_for(q, quads=False)  # default is rectangles
        rects = page.search_for(q)
        if not rects:
            continue

        # make a simple snippet from the page text
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
        return jsonify({"error": "Provide uploaded file 'id'"}), 400

    pdf_path = os.path.join(UPLOAD_DIR, file_id)
    if not os.path.exists(pdf_path):
        return jsonify({"error": "File not found"}), 404

    try:
        out = build_outline_for_file(pdf_path, model_path=YOLO_MODEL, dpi=200)
        # out.outline has 0-based pages; Adobe expects 1-based — frontend can +1.
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
    # CORS header for convenience
    resp = send_from_directory(UPLOAD_DIR, filename)
    resp.headers["Access-Control-Allow-Origin"] = FRONTEND_ORIGIN if FRONTEND_ORIGIN != "*" else "*"
    return resp


@app.post("/api/headings")
def headings():
    data = request.get_json(force=True, silent=True) or {}
    file_id = data.get("id")
    if not file_id:
        return jsonify({"error": "Provide uploaded file 'id'"}), 400

    try:
        doc, _ = _open_doc(file_id)
        hs = _extract_headings(doc)
        return jsonify({"headings": hs})
    except FileNotFoundError:
        return jsonify({"error": "File not found"}), 404
    except Exception as e:
        return jsonify({"error": "failed", "detail": str(e)}), 500


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

    # simple flavored placeholders – swap with your LLM later
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
    for fid in ids[:1]:  # quick example: peek first doc for pages 2,4
        try:
            doc, _ = _open_doc(fid)
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
