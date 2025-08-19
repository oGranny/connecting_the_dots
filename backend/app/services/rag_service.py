import os
import glob
import json
import uuid
import time
import threading
from typing import List, Dict, Any, Tuple, Optional
import logging

import numpy as np
import fitz

from ..config import Config
from .genai_service import ensure_genai_client, RpsLimiter, with_retry

# ---- math helpers
def l2norm_rows(M: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(M, axis=1, keepdims=True)
    n = np.maximum(n, 1e-12)
    return M / n

def chunk_text(txt: str, max_chars: int, overlap: int):
    txt = txt or ""
    n = len(txt)
    if n == 0:
        return []
    out, i = [], 0
    while i < n:
        j = min(n, i + max_chars)
        out.append((txt[i:j], i, j))
        if j == n:
            break
        i = max(0, j - overlap)
    return out

def extract_pdf_chunks(pdf_path: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    try:
        doc = fitz.open(pdf_path)
        for page_idx, page in enumerate(doc):
            text = page.get_text("text", sort=True)
            for ch, s, e in chunk_text(text, Config.CHUNK_CHARS, Config.CHUNK_OVERLAP):
                ch = ch[:Config.CTX_SNIPPET_CHARS]
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

# ---- cache helpers
import hashlib
def _hash_text(t: str) -> str:
    return hashlib.sha1((t or "").encode("utf-8")).hexdigest()

def load_embed_cache(cache_fp: str) -> Dict[str, List[float]]:
    cache = {}
    if os.path.exists(cache_fp):
        with open(cache_fp, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    row = json.loads(line)
                    h, v = row.get("h"), row.get("v")
                    if isinstance(h, str) and isinstance(v, list):
                        cache[h] = v
                except Exception:
                    continue
    return cache

def append_embed_cache(cache_fp: str, items: List[Tuple[str, List[float]]]):
    if not items:
        return
    with open(cache_fp, "a", encoding="utf-8") as f:
        for h, v in items:
            f.write(json.dumps({"h": h, "v": v}) + "\n")

# ---- embedding & gen
_embed_limiter = RpsLimiter(Config.EMBED_RPS)
_gen_limiter = RpsLimiter(Config.GEN_RPS)

def embed_texts(texts: List[str], model: str, dim: int, task_type: str, cache_fp: Optional[str]) -> np.ndarray:
    if not texts:
        return np.zeros((0, dim), dtype=np.float32)
    client = ensure_genai_client()
    cache = load_embed_cache(cache_fp) if cache_fp else {}
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

    for start in range(0, len(todo_texts), Config.EMBED_BATCH):
        end = min(start + Config.EMBED_BATCH, len(todo_texts))
        batch = todo_texts[start:end]

        def _call():
            from google.genai import types
            return client.models.embed_content(
                model=model,
                contents=batch,
                config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=dim),
            )

        res = with_retry(_call, _embed_limiter, Config.MAX_RETRIES, Config.BASE_BACKOFF, Config.MAX_BACKOFF)
        for j, e in enumerate(res.embeddings):
            idx = todo_idxs[start + j]
            vec = np.array(e.values, dtype=np.float32)
            outM[idx] = vec
            if cache is not None:
                new_cache.append((_hash_text(texts[idx]), vec.astype(float).tolist()))
    if cache_fp and new_cache:
        append_embed_cache(cache_fp, new_cache)
    return outM

def make_prompt(query: str, contexts: List[Dict[str, Any]]) -> str:
    used = 0
    parts = []
    for c in contexts:
        t = c['text'][:Config.CTX_SNIPPET_CHARS]
        if used + len(t) > Config.CTX_BUDGET_CHARS:
            break
        used += len(t)
        parts.append(f"[{c['rank']}] {c['pdf_name']} p.{c['page']} ({c['start']}-{c['end']}):\n{t}")
    ctx = "\n\n".join(parts)
    
    head = (
        "You are a helpful document analyst. Based ONLY on the provided PDF excerpts below, "
        "answer the user's question with specific insights and details.\n\n"
        "IMPORTANT RULES:\n"
        "- Use ONLY information from the provided excerpts\n"
        "- Always provide a substantive answer if any relevant information exists\n"
        "- If the excerpts contain relevant information, explain what they reveal\n"
        "- Reference specific details, examples, or concepts from the excerpts\n"
        "- If truly no relevant information exists, clearly state that\n"
        "- NEVER give an empty response\n"
        "- Write in a clear, informative style\n\n"
    )
    
    return f"{head}QUESTION: {query}\n\nPDF EXCERPTS:\n{ctx}\n\nDETAILED ANSWER:"

def generate_answer(query: str, contexts: List[Dict[str, Any]], model: str, temperature: float) -> str:
    client = ensure_genai_client()
    
    def _call():
        from google.genai import types
        prompt = make_prompt(query, contexts)
        return client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=temperature, 
                max_output_tokens=Config.MAX_OUTPUT_TOKENS_DEFAULT
            ),
        )

    # Try generating answer up to 3 times if empty
    for attempt in range(3):
        try:
            resp = with_retry(_call, _gen_limiter, Config.MAX_RETRIES, Config.BASE_BACKOFF, Config.MAX_BACKOFF)
            answer = (getattr(resp, "text", None) or "").strip()
            
            if answer:  # Got a non-empty answer
                return answer
            elif attempt < 2:  # Retry with different temperature
                temperature = min(0.9, temperature + 0.2)
                print(f"Empty answer attempt {attempt + 1}, retrying with temperature {temperature}")
                continue
            else:  # Final attempt failed, provide fallback
                print("LLM provided empty answer after 3 attempts, using fallback")
                return generate_fallback_answer(query, contexts)
                
        except Exception as e:
            if attempt < 2:
                print(f"Answer generation failed attempt {attempt + 1}: {e}")
                continue
            else:
                print(f"Answer generation failed after 3 attempts: {e}")
                return generate_fallback_answer(query, contexts)

def generate_fallback_answer(query: str, contexts: List[Dict[str, Any]]) -> str:
    """Generate a structured fallback answer when LLM fails"""
    if not contexts:
        return f"I couldn't find relevant information about '{query}' in the uploaded documents."
    
    # Create a structured response from the contexts
    key_points = []
    for i, ctx in enumerate(contexts[:3]):  # Use top 3 contexts
        snippet = ctx['text'][:200].strip()
        if snippet:
            key_points.append(f"• From {ctx.get('pdf_name', 'document')} (page {ctx.get('page', '?')}): {snippet}...")
    
    if key_points:
        return f"Based on your query about '{query}', here are the most relevant findings:\n\n" + "\n".join(key_points)
    else:
        return f"I found {len(contexts)} potentially relevant sections for '{query}', but couldn't extract clear insights. Please check the source references."

# ---- RAG Index
class RAGIndex:
    def __init__(self):
        self.lock = threading.Lock()
        self.V: Optional[np.ndarray] = None
        self.metas: List[Dict[str, Any]] = []
        self.files_reg: Dict[str, Dict[str, Any]] = {}
        self.is_indexing = False
        self.last_updated = None
        self._load_from_disk()

    def _rewrite_meta_file(self):
        # Rewrites the meta file from self.metas (full snapshot).
        with open(Config.META_PATH, "w", encoding="utf-8") as f:
            for r in self.metas:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")

    def _remove_paths_from_index_locked(self, abs_paths: List[str]):
        """Assumes self.lock is already held. Removes all rows/vectors for given pdf paths."""
        if not abs_paths:
            return

        # Build a keep-mask so we can filter both metas and V consistently.
        path_set = set(map(os.path.abspath, abs_paths))
        keep_idxs = []
        for i, m in enumerate(self.metas):
            p = os.path.abspath(m.get("pdf_path", ""))
            if p not in path_set:
                keep_idxs.append(i)

        # Nothing to drop
        if len(keep_idxs) == len(self.metas):
            return

        # Filter metas
        self.metas = [self.metas[i] for i in keep_idxs]

        # Filter vectors (guard for partial writes)
        if self.V is not None and self.V.size > 0:
            n_vecs = int(self.V.shape[0])
            n_meta = len(keep_idxs)
            # keep only valid range then index
            if n_vecs >= len(keep_idxs):
                self.V = self.V[keep_idxs, :]
            else:
                # If vectors < metas (shouldn't happen but be safe), truncate metas to match.
                self.metas = self.metas[:n_vecs]

        # Update registry: drop removed files
        for ap in path_set:
            if ap in self.files_reg:
                self.files_reg.pop(ap, None)

        # Persist snapshot
        self._rewrite_meta_file()
        np.save(Config.VEC_PATH, self.V if self.V is not None else np.zeros((0, Config.EMBED_DIM), dtype=np.float32))
        self._save_registry()
        self.last_updated = time.time()

    def remove_pdfs(self, pdf_paths: List[str]):
        """Public method: remove files from index by absolute or relative paths."""
        if not pdf_paths:
            return
        with self.lock:
            # If indexing is in progress, we still proceed atomically under the same lock.
            self._remove_paths_from_index_locked(pdf_paths)

    def remove_by_ids(self, ids: List[str]):
        """
        Convenience: remove files by uploaded filename IDs (same as used in /uploads/<id>).
        """
        if not ids:
            return
        paths = [os.path.abspath(os.path.join(Config.UPLOAD_DIR, fid)) for fid in ids]
        self.remove_pdfs(paths)

    def _load_from_disk(self):
        if os.path.exists(Config.META_PATH):
            with open(Config.META_PATH, "r", encoding="utf-8") as f:
                self.metas = [json.loads(line) for line in f if line.strip()]
        else:
            self.metas = []
        if os.path.exists(Config.VEC_PATH):
            self.V = np.load(Config.VEC_PATH)
        else:
            self.V = np.zeros((0, Config.EMBED_DIM), dtype=np.float32)
        if os.path.exists(Config.FILES_REG_PATH):
            with open(Config.FILES_REG_PATH, "r", encoding="utf-8") as f:
                self.files_reg = json.load(f)
        else:
            self.files_reg = {}
        if self.metas and self.V is not None:
            self.last_updated = time.time()

    def _save_registry(self):
        with open(Config.FILES_REG_PATH, "w", encoding="utf-8") as f:
            json.dump(self.files_reg, f, indent=2)

    def _append_index(self, new_metas: List[Dict[str, Any]], new_vecs: np.ndarray):
        self.metas.extend(new_metas)
        if self.V is None or self.V.size == 0:
            self.V = new_vecs.copy()
        else:
            self.V = np.vstack([self.V, new_vecs])
        with open(Config.META_PATH, "a", encoding="utf-8") as f:
            for r in new_metas:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        np.save(Config.VEC_PATH, self.V)
        self.last_updated = time.time()

    def _extract_and_embed(self, pdf_paths: List[str]) -> Tuple[List[Dict[str, Any]], np.ndarray]:
        rows: List[Dict[str, Any]] = []
        for p in pdf_paths:
            rows.extend(extract_pdf_chunks(p))
        texts = [r["text"] for r in rows]
        M = embed_texts(texts, Config.EMBED_MODEL, Config.EMBED_DIM,
                        "RETRIEVAL_DOCUMENT", cache_fp=Config.EMBED_CACHE_PATH)
        M = l2norm_rows(M)
        return rows, M

    def index_pdfs(self, pdf_paths: List[str]):
        if not pdf_paths:
            return
        with self.lock:
            self.is_indexing = True
        try:
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
        pdfs = sorted(glob.glob(os.path.join(Config.UPLOAD_DIR, "*.pdf")))
        self.index_pdfs(pdfs)

    def topk_search(self, q: str, k: int) -> List[Dict[str, Any]]:
        if self.V is None or self.V.shape[0] == 0:
            return []
        Q = embed_texts([q], Config.EMBED_MODEL, Config.EMBED_DIM, "QUESTION_ANSWERING", cache_fp=None)
        if Q.shape[0] == 0:
            return []
        qv = Q[0]
        qv = qv / (np.linalg.norm(qv) + 1e-12)
        # Guard: vectors and metas can drift if an index write was interrupted.
        n_vecs = int(self.V.shape[0])
        n_meta = int(len(self.metas))
        n = min(n_vecs, n_meta)
        if n <= 0:
            return []
        sims = (self.V[:n] @ qv)
        k = min(k, n)
        idxs = np.argpartition(-sims, k-1)[:k]
        idxs = idxs[np.argsort(-sims[idxs])]
        out: List[Dict[str, Any]] = []
        for rank, i in enumerate(idxs, start=1):
            # Extra safety in case of any lingering mismatch
            if i < 0 or i >= len(self.metas):
                continue
            m = self.metas[i]
            txt = (m["text"] or "")[:Config.CTX_SNIPPET_CHARS]
            out.append({
                "rank": rank, "score": float(sims[i]),
                "pdf_name": m["pdf_name"], "pdf_path": m["pdf_path"],
                "page": m["page"], "start": m["start"], "end": m["end"],
                "text": txt, "chunk_id": m.get("id"),
            })
        return out

    def answer(self, query: str, top_k: int = 10) -> Dict[str, Any]:
        contexts = self.topk_search(query, top_k)
        if not contexts:
            return {
                "answer": "I couldn't find relevant information in the PDFs.",
                "contexts": [],
                "model": Config.GEN_MODEL,
                "embedding_model": Config.EMBED_MODEL,
            }
        
        # Generate answer
        logging.info(f"Generating answer for query: {query[:50]}... with {len(contexts)} contexts")
        answer_text = generate_answer(query, contexts, Config.GEN_MODEL, Config.TEMPERATURE)
        
        logging.info(f"Generated answer length: {len(answer_text)} characters")
        if len(answer_text) < 10:
            logging.warning(f"Very short answer generated: '{answer_text}'")
        
        return {
            "answer": answer_text,
            "contexts": contexts,
            "query": query
        }

# Global RAG instance + async helper
rag = RAGIndex()

def index_async(paths: List[str]):
    t = threading.Thread(target=rag.index_pdfs, args=(paths,), daemon=True)
    t.start()
