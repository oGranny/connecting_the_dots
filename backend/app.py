import os
import re
import uuid
import json
import time
import glob
import threading
from typing import List, Dict, Any, Tuple, Optional
from queue import Queue

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename
from outline_yolo import build_outline_for_file

import fitz  # PyMuPDF
from dotenv import load_dotenv

# --------- RAG deps ---------
import numpy as np

try:
    from google import genai
    from google.genai import types
except Exception:
    genai = None
    types = None

load_dotenv()

YOLO_MODEL = os.getenv("YOLO_MODEL", os.path.join(os.path.dirname(__file__), "model", "model.pt"))

# ----------------- Config -----------------
PORT = int(os.getenv("PORT", "4000"))
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "*")
BASE_DIR = os.path.dirname(__file__)
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_MIME = {"application/pdf"}

# ---------- RAG Config ----------
RAG_DIR = os.getenv("RAG_OUT_DIR", os.path.join(BASE_DIR, "rag_index"))
os.makedirs(RAG_DIR, exist_ok=True)

# Models
EMBED_MODEL = os.getenv("EMBED_MODEL_DEFAULT", "text-embedding-004")
GEN_MODEL = os.getenv("GEN_MODEL_DEFAULT", "gemini-2.5-flash")

# Dimensions & chunking
EMBED_DIM = int(os.getenv("EMBED_DIM_DEFAULT", "768"))
CHUNK_CHARS = int(os.getenv("CHUNK_CHARS_DEFAULT", "900"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP_DEFAULT", "150"))

# Retrieval & generation
TOP_K_DEFAULT = int(os.getenv("TOP_K_DEFAULT", "5"))
TEMPERATURE = float(os.getenv("TEMPERATURE_DEFAULT", "0.2"))
MAX_OUTPUT_TOKENS_DEFAULT = int(os.getenv("MAX_OUTPUT_TOKENS", "800"))

# Context guardrails
CTX_BUDGET_CHARS = int(os.getenv("CTX_BUDGET_CHARS", "4000"))
CTX_SNIPPET_CHARS = int(os.getenv("CTX_SNIPPET_CHARS", "900"))

# Embed batching/limits
EMBED_BATCH = int(os.getenv("EMBED_BATCH", "100"))
EMBED_RPS = float(os.getenv("EMBED_RPS", "0.5"))
GEN_RPS = float(os.getenv("GEN_RPS", "0.2"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "8"))
BASE_BACKOFF = float(os.getenv("BASE_BACKOFF", "1.5"))
MAX_BACKOFF = float(os.getenv("MAX_BACKOFF", "20.0"))

# Files
VEC_PATH = os.path.join(RAG_DIR, "vectors.npy")
META_PATH = os.path.join(RAG_DIR, "meta.jsonl")
EMBED_CACHE_PATH = os.path.join(RAG_DIR, "embed_cache.jsonl")
FILES_REG_PATH = os.path.join(RAG_DIR, "files_registry.json")  # {abs_pdf_path: {"mtime": float, "chunks": int}}

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
    sizes = sorted(set(round(s, 1) for s in sizes), reverse=True)
    out = []
    for s in sizes:
        if not out or abs(out[-1] - s) > eps:
            out.append(s)
    return out

def _extract_headings(doc: fitz.Document, max_levels: int = 3) -> List[Dict[str, Any]]:
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
                    if len(text) < 3:
                        continue
                    size = float(span.get("size", 0))
                    all_sizes.append(size)
                    spans.append({
                        "page": pno + 1,
                        "text": text,
                        "size": size,
                        "bbox": span.get("bbox"),
                        "font": span.get("font"),
                    })
    if not spans:
        return []
    top_sizes = _normalize_sizes(all_sizes)
    levels = top_sizes[:max_levels]
    results = []
    for s in spans:
        try:
            level = levels.index(min(levels, key=lambda L: abs(L - s["size"]))) + 1
        except ValueError:
            continue
        if s["size"] < levels[min(len(levels) - 1, 2)] - 0.2 and level > 2:
            continue
        title = re.sub(r"\s+", " ", s["text"]).strip()
        if len(title) > 140:
            title = title[:137] + "…"
        results.append({
            "id": uuid.uuid4().hex,
            "level": level,
            "title": title,
            "page": s["page"],
        })
    deduped = []
    seen_on_page = set()
    for h in results:
        key = (h["page"], h["title"].lower())
        if key in seen_on_page:
            continue
        deduped.append(h)
        seen_on_page.add(key)
    deduped.sort(key=lambda x: (x["page"], x["level"]))
    return deduped

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

# ----------------- RAG core -----------------
def _ensure_genai():
    if genai is None or types is None:
        raise RuntimeError("google-genai not installed. pip install google-genai")
    key = os.getenv("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError("GOOGLE_API_KEY env var not set")
    return genai.Client()

class _RpsLimiter:
    def __init__(self, rps: float):
        self.min_interval = 1.0 / max(1e-6, rps)
        self._last = 0.0
        self._lock = threading.Lock()
    def wait(self):
        with self._lock:
            now = time.time()
            wait_for = self.min_interval - (now - self._last)
            if wait_for > 0:
                time.sleep(wait_for)
            self._last = time.time()

def _is_retryable(e: Exception) -> bool:
    s = str(e).lower()
    keys = ["429", "rate", "quota", "resourceexhausted", "exceeded", "retry", "temporarily"]
    return any(k in s for k in keys)

def _with_retry(fn, limiter: Optional[_RpsLimiter] = None):
    last_err = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            if limiter:
                limiter.wait()
            return fn()
        except Exception as e:
            if not _is_retryable(e) or attempt == MAX_RETRIES:
                last_err = e
                break
            sleep_s = min(MAX_BACKOFF, (BASE_BACKOFF * (2 ** attempt)))
            time.sleep(sleep_s)
    raise last_err

_embed_limiter = _RpsLimiter(EMBED_RPS)
_gen_limiter = _RpsLimiter(GEN_RPS)

def _l2norm_rows(M: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(M, axis=1, keepdims=True)
    n = np.maximum(n, 1e-12)
    return M / n

def _chunk_text(txt: str, max_chars: int, overlap: int) -> List[Tuple[str, int, int]]:
    txt = txt or ""
    n = len(txt)
    if n == 0:
        return []
    out = []
    i = 0
    while i < n:
        j = min(n, i + max_chars)
        out.append((txt[i:j], i, j))
        if j == n:
            break
        i = max(0, j - overlap)
    return out

def _extract_pdf_chunks(pdf_path: str, max_chars: int, overlap: int) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    try:
        doc = fitz.open(pdf_path)
        for page_idx, page in enumerate(doc):
            text = page.get_text("text", sort=True)
            for ch, s, e in _chunk_text(text, max_chars, overlap):
                ch = ch[:CTX_SNIPPET_CHARS]
                rows.append({
                    "id": str(uuid.uuid4()),
                    "pdf_path": os.path.abspath(pdf_path),
                    "pdf_name": os.path.basename(pdf_path),
                    "page": page_idx + 1,
                    "start": int(s),
                    "end": int(e),
                    "text": ch,
                })
        doc.close()
    except Exception as ex:
        print(f"[WARN] Failed {pdf_path}: {ex}")
    return rows

def _hash_text(t: str) -> str:
    import hashlib
    return hashlib.sha1((t or "").encode("utf-8")).hexdigest()

def _load_embed_cache(cache_fp: str) -> Dict[str, List[float]]:
    cache = {}
    if os.path.exists(cache_fp):
        with open(cache_fp, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    row = json.loads(line)
                    h = row.get("h")
                    v = row.get("v")
                    if isinstance(h, str) and isinstance(v, list):
                        cache[h] = v
                except Exception:
                    continue
    return cache

def _append_embed_cache(cache_fp: str, items: List[Tuple[str, List[float]]]):
    if not items:
        return
    with open(cache_fp, "a", encoding="utf-8") as f:
        for h, v in items:
            f.write(json.dumps({"h": h, "v": v}) + "\n")

def _embed_texts(texts: List[str], model: str, dim: int, task_type: str, cache_fp: Optional[str]) -> np.ndarray:
    if not texts:
        return np.zeros((0, dim), dtype=np.float32)
    client = _ensure_genai()
    cache = _load_embed_cache(cache_fp) if cache_fp else {}
    outM = np.zeros((len(texts), dim), dtype=np.float32)
    todo_idxs, todo_texts, new_cache = [], [], []

    for i, t in enumerate(texts):
        h = _hash_text(t)
        if h in cache:
            v = np.array(cache[h], dtype=np.float32)
            if v.shape[0] == dim:
                outM[i] = v
                continue
        todo_idxs.append(i)
        todo_texts.append(t)

    for start in range(0, len(todo_texts), EMBED_BATCH):
        end = min(start + EMBED_BATCH, len(todo_texts))
        batch = todo_texts[start:end]
        def _call():
            return client.models.embed_content(
                model=model,
                contents=batch,
                config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=dim),
            )
        res = _with_retry(_call, limiter=_embed_limiter)
        for j, e in enumerate(res.embeddings):
            idx = todo_idxs[start + j]
            vec = np.array(e.values, dtype=np.float32)
            outM[idx] = vec
            if cache is not None:
                new_cache.append((_hash_text(texts[idx]), vec.astype(float).tolist()))
    if cache_fp and new_cache:
        _append_embed_cache(cache_fp, new_cache)
    return outM

def _make_prompt(query: str, contexts: List[Dict[str, Any]]) -> str:
    used = 0
    parts = []
    for c in contexts:
        t = c['text'][:CTX_SNIPPET_CHARS]
        if used + len(t) > CTX_BUDGET_CHARS:
            break
        used += len(t)
        parts.append(f"[{c['rank']}] {c['pdf_name']} p.{c['page']} ({c['start']}-{c['end']}):\n{t}")
    ctx = "\n\n".join(parts)
    head = (
        "Answer strictly from the provided PDF excerpts.\n"
        "If the answer is not present, say you don't know.\n"
        "Cite source numbers like [1], [2] inline.\n"
    )
    return f"{head}\n\nQUESTION:\n{query}\n\nCONTEXTS:\n{ctx}\n\nAnswer:"

def _generate_answer(query: str, contexts: List[Dict[str, Any]], model: str, temperature: float) -> str:
    client = _ensure_genai()
    prompt = _make_prompt(query, contexts)
    def _call():
        return client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=temperature, max_output_tokens=MAX_OUTPUT_TOKENS_DEFAULT),
        )
    resp = _with_retry(_call, limiter=_gen_limiter)
    return (getattr(resp, "text", None) or "").strip()

# --------- RAG Index manager (persistent, incremental) ----------
class RAGIndex:
    def __init__(self):
        self.lock = threading.Lock()
        self.V: Optional[np.ndarray] = None
        self.metas: List[Dict[str, Any]] = []
        self.files_reg: Dict[str, Dict[str, Any]] = {}
        self.is_indexing = False
        self.last_updated = None
        self._load_from_disk()

    def _load_from_disk(self):
        # load metas
        if os.path.exists(META_PATH):
            with open(META_PATH, "r", encoding="utf-8") as f:
                self.metas = [json.loads(line) for line in f if line.strip()]
        else:
            self.metas = []
        # load vectors
        if os.path.exists(VEC_PATH):
            self.V = np.load(VEC_PATH)
        else:
            self.V = np.zeros((0, EMBED_DIM), dtype=np.float32)
        # files registry
        if os.path.exists(FILES_REG_PATH):
            with open(FILES_REG_PATH, "r", encoding="utf-8") as f:
                self.files_reg = json.load(f)
        else:
            self.files_reg = {}
        if self.metas and self.V is not None:
            self.last_updated = time.time()

    def _save_registry(self):
        with open(FILES_REG_PATH, "w", encoding="utf-8") as f:
            json.dump(self.files_reg, f, indent=2)

    def _append_index(self, new_metas: List[Dict[str, Any]], new_vecs: np.ndarray):
        # Append to in-memory
        self.metas.extend(new_metas)
        if self.V is None or self.V.size == 0:
            self.V = new_vecs.copy()
        else:
            self.V = np.vstack([self.V, new_vecs])
        # Persist
        with open(META_PATH, "a", encoding="utf-8") as f:
            for r in new_metas:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        np.save(VEC_PATH, self.V)
        self.last_updated = time.time()

    def _extract_and_embed(self, pdf_paths: List[str]) -> Tuple[List[Dict[str, Any]], np.ndarray]:
        rows: List[Dict[str, Any]] = []
        for p in pdf_paths:
            rows.extend(_extract_pdf_chunks(p, CHUNK_CHARS, CHUNK_OVERLAP))
        texts = [r["text"] for r in rows]
        M = _embed_texts(texts, EMBED_MODEL, EMBED_DIM, "RETRIEVAL_DOCUMENT", cache_fp=EMBED_CACHE_PATH)
        M = _l2norm_rows(M)
        return rows, M

    def index_pdfs(self, pdf_paths: List[str]):
        if not pdf_paths:
            return
        with self.lock:
            self.is_indexing = True
        try:
            # filter unchanged by mtime
            paths_to_index = []
            for p in pdf_paths:
                ap = os.path.abspath(p)
                if not os.path.exists(ap):
                    continue
                mt = os.path.getmtime(ap)
                rec = self.files_reg.get(ap)
                if (rec is None) or (abs(rec.get("mtime", 0.0) - mt) > 1e-6):
                    paths_to_index.append(ap)
            if not paths_to_index:
                return
            rows, M = self._extract_and_embed(paths_to_index)
            if rows:
                self._append_index(rows, M)
            # update registry counts by file
            by_file = {}
            for r in rows:
                by_file.setdefault(r["pdf_path"], 0)
                by_file[r["pdf_path"]] += 1
            for ap in paths_to_index:
                self.files_reg[ap] = {"mtime": os.path.getmtime(ap), "chunks": by_file.get(ap, 0)}
            self._save_registry()
        finally:
            with self.lock:
                self.is_indexing = False

    def index_all_in_uploads(self):
        pdfs = sorted(glob.glob(os.path.join(UPLOAD_DIR, "*.pdf")))
        self.index_pdfs(pdfs)

    def topk_search(self, q: str, k: int) -> List[Dict[str, Any]]:
        if self.V is None or self.V.shape[0] == 0:
            return []
        Q = _embed_texts([q], EMBED_MODEL, EMBED_DIM, "QUESTION_ANSWERING", cache_fp=None)
        if Q.shape[0] == 0:
            return []
        qv = Q[0]
        qv = qv / (np.linalg.norm(qv) + 1e-12)
        sims = self.V @ qv
        if k > len(sims):
            k = len(sims)
        idxs = np.argpartition(-sims, k-1)[:k]
        idxs = idxs[np.argsort(-sims[idxs])]
        out: List[Dict[str, Any]] = []
        for rank, i in enumerate(idxs, start=1):
            m = self.metas[i]
            txt = (m["text"] or "")[:CTX_SNIPPET_CHARS]
            out.append({
                "rank": rank,
                "score": float(sims[i]),
                "pdf_name": m["pdf_name"],
                "pdf_path": m["pdf_path"],
                "page": m["page"],
                "start": m["start"],
                "end": m["end"],
                "text": txt,
                "chunk_id": m.get("id"),
            })
        return out

    def answer(self, q: str, top_k: int) -> Dict[str, Any]:
        hits = self.topk_search(q, top_k)
        if not hits:
            return {
                "answer": "I couldn't find relevant information in the PDFs.",
                "contexts": [],
                "model": GEN_MODEL,
                "embedding_model": EMBED_MODEL,
            }
        ans = _generate_answer(q, hits, GEN_MODEL, TEMPERATURE)
        return {
            "answer": ans,
            "contexts": hits,
            "model": GEN_MODEL,
            "embedding_model": EMBED_MODEL,
        }

rag = RAGIndex()

def _index_async(paths: List[str]):
    t = threading.Thread(target=rag.index_pdfs, args=(paths,), daemon=True)
    t.start()

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
    saved_paths = []
    if "file" in request.files:
        file = request.files["file"]
        meta = _save_pdf(file)
        saved_paths.append(os.path.join(UPLOAD_DIR, meta["id"]))
        # fire-and-forget indexing of this PDF
        _index_async(saved_paths)
        return jsonify(meta)

    files = request.files.getlist("files[]")
    if not files:
        return jsonify({"error": "No file(s) provided"}), 400

    metas = []
    for f in files:
        m = _save_pdf(f)
        metas.append(m)
        saved_paths.append(os.path.join(UPLOAD_DIR, m["id"]))

    # background index for all uploaded PDFs
    _index_async(saved_paths)
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

# ---------- NEW: RAG endpoints ----------
@app.get("/api/rag/status")
def rag_status():
    return jsonify({
        "chunks": int(0 if rag.V is None else rag.V.shape[0]),
        "dim": EMBED_DIM,
        "isIndexing": rag.is_indexing,
        "lastUpdated": rag.last_updated,
        "embedModel": EMBED_MODEL,
        "genModel": GEN_MODEL,
    })

@app.post("/api/rag/index")
def rag_index_now():
    # Manual trigger to (re)index everything in uploads
    _index_async(sorted(glob.glob(os.path.join(UPLOAD_DIR, "*.pdf"))))
    return jsonify({"ok": True})

@app.post("/api/rag/query")
def rag_query():
    data = request.get_json(force=True, silent=True) or {}
    q = (data.get("q") or "").strip()
    top_k = int(data.get("top_k", TOP_K_DEFAULT))
    if not q:
        return jsonify({"error": "Provide 'q'"}), 400
    try:
        resp = rag.answer(q, top_k)
        # include a hint if indexing is ongoing or empty
        meta = {
            "isIndexing": rag.is_indexing,
            "chunks": int(0 if rag.V is None else rag.V.shape[0]),
        }
        resp["_meta"] = meta
        return jsonify(resp)
    except Exception as e:
        return jsonify({"error": "rag-failed", "detail": str(e)}), 500

@app.post("/api/podcast")
def podcast():
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
    app.run(host="127.0.0.1", port=4000, debug=True)
