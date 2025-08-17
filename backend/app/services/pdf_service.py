import os
import re
import uuid
from typing import List, Dict, Any, Tuple

import fitz  # PyMuPDF
from werkzeug.utils import secure_filename
from ..config import Config

def save_pdf(file_storage) -> Dict[str, Any]:
    if file_storage.mimetype not in Config.ALLOWED_MIME:
        raise ValueError("Only PDF files are allowed")
    safe_name = secure_filename(file_storage.filename or "document.pdf")
    file_id = f"{uuid.uuid4().hex}_{safe_name}"
    path = os.path.join(Config.UPLOAD_DIR, file_id)
    file_storage.save(path)
    return {
        "id": file_id,
        "name": file_storage.filename,
        "size": os.path.getsize(path),
        "url": f"/uploads/{file_id}",
        "mimetype": file_storage.mimetype,
    }

def open_doc(file_id: str) -> Tuple[fitz.Document, str]:
    path = os.path.join(Config.UPLOAD_DIR, file_id)
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

def extract_headings(doc: fitz.Document, max_levels: int = 3) -> List[Dict[str, Any]]:
    spans, all_sizes = [], []
    for pno in range(len(doc)):
        page = doc[pno]
        d = page.get_text("dict")
        for block in d.get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = (span.get("text") or "").strip()
                    if not text or len(text) < 3:
                        continue
                    size = float(span.get("size", 0))
                    all_sizes.append(size)
                    spans.append({
                        "page": pno + 1, "text": text, "size": size,
                        "bbox": span.get("bbox"), "font": span.get("font"),
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
        results.append({"id": uuid.uuid4().hex, "level": level, "title": title, "page": s["page"]})
    deduped, seen = [], set()
    for h in results:
        key = (h["page"], h["title"].lower())
        if key in seen:
            continue
        deduped.append(h)
        seen.add(key)
    deduped.sort(key=lambda x: (x["page"], x["level"]))
    return deduped

def search_pdf(doc: fitz.Document, query: str, limit: int = 10) -> List[Dict[str, Any]]:
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
        out.append({"page": pno + 1, "count": len(rects), "snippet": snippet})
        if len(out) >= limit:
            break
    return out
