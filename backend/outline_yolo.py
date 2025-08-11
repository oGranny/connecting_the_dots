# outline_yolo.py
# Extract H1/H2/H3 headings from a single PDF using DocLayout-YOLO + PyMuPDF.

import os, re, json
from pathlib import Path
from typing import Dict, Any, List

import fitz  # PyMuPDF
import cv2
from PIL import Image
import numpy as np
from collections import defaultdict

from doclayout_yolo import YOLOv10

try:
    from sklearn.cluster import KMeans
    _HAS_SKLEARN = True
except Exception:
    _HAS_SKLEARN = False


def _clean_text(t: str) -> str:
    t = re.sub(r"\s+", " ", (t or "").strip())
    t = re.sub(r"^[•\-\u2022\.\s]+", "", t)
    return t


def _is_title_like(name: str) -> bool:
    n = name.lower().replace("_", "-").strip()
    if "page" in n and "header" in n:
        return False
    if "title" in n:
        return True
    if "section" in n and "header" in n:
        return True
    if "heading" in n:
        return True
    return False


def _cluster_levels_by_height(cands: List[Dict[str, Any]]) -> List[str]:
    """
    Assign H1/H2/H3 by clustering candidate box heights.
    Returns a parallel list of 'H1'/'H2'/'H3'.
    """
    if not cands:
        return []

    K = min(3, len(cands))
    heights = np.array([[c["h_px"]] for c in cands], dtype=float)

    if _HAS_SKLEARN and K >= 2:
        km = KMeans(n_clusters=K, random_state=42, n_init=10)
        labels = km.fit_predict(heights)
        centers = km.cluster_centers_.ravel()
        order = np.argsort(centers)[::-1]  # largest height first
    else:
        # Fallback: simple quantile bucketing
        if K == 1:
            labels = np.zeros(len(cands), dtype=int)
            order = [0]
        else:
            qs = np.quantile(heights.ravel(), np.linspace(0, 1, K + 1))
            labels = np.zeros(len(cands), dtype=int)
            for i, h in enumerate(heights.ravel()):
                for b in range(K):
                    if qs[b] <= h <= qs[b + 1]:
                        labels[i] = min(b, K - 1)
                        break
            means = [np.mean(heights.ravel()[labels == b]) for b in range(K)]
            order = np.argsort(means)[::-1]

    cluster_to_level = {order[i]: f"H{i+1}" for i in range(K)}
    return [cluster_to_level[int(lab)] for lab in labels]


def _convert_pdf_page_to_image(pdf_path: str, page_idx: int, dpi: int = 200) -> Image.Image | None:
    """Return PIL image for PDF page (0-based index)."""
    try:
        doc = fitz.open(pdf_path)
        page = doc[page_idx]
        pix = page.get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72))
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        doc.close()
        return img
    except Exception as e:
        print(f"[outline_yolo] page->img error p{page_idx+1}: {e}")
        return None


# ---- Lazy model cache so we don't reload for each request ----
_MODEL = None
_MODEL_PATH = None

def _get_model(model_path: str) -> YOLOv10:
    global _MODEL, _MODEL_PATH
    if _MODEL is None or _MODEL_PATH != model_path:
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"DocLayout-YOLO model not found at: {os.path.abspath(model_path)}")
        _MODEL = YOLOv10(model_path)
        _MODEL_PATH = model_path
    return _MODEL


def build_outline_for_file(pdf_path: str, model_path: str, dpi: int = 200) -> Dict[str, Any]:
    """
    Process a single PDF and return:
      {
        "title": "<doc title or ''>",
        "outline": [
          {"level":"H1|H2|H3","text":"...", "page": <0-based page index>},
          ...
        ]
      }
    """
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(pdf_path)

    model = _get_model(model_path)
    _SCALE = dpi / 72.0  # px per PDF point
    doc = fitz.open(pdf_path)

    title_candidates: List[Dict[str, Any]] = []

    try:
        for page_idx in range(doc.page_count):
            pil_img = _convert_pdf_page_to_image(pdf_path, page_idx, dpi=dpi)
            if pil_img is None:
                continue

            # PIL -> OpenCV (BGR)
            cv_img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
            # Save to a temp file because doclayout_yolo .predict expects a path
            tmp_path = str(Path(pdf_path).with_suffix(f".p{page_idx+1}.jpg"))
            cv2.imwrite(tmp_path, cv_img)

            try:
                det = model.predict(tmp_path, imgsz=1024, conf=0.2)[0]
                names = getattr(det, "names", {}) or {}
                if not names and hasattr(det, "boxes") and hasattr(det.boxes, "cls"):
                    uniq = np.unique(det.boxes.cls.cpu().numpy()).astype(int).tolist()
                    names = {i: str(i) for i in uniq}

                wanted = {i for i, n in names.items() if _is_title_like(str(n))}
                if not hasattr(det, "boxes") or det.boxes is None or not len(det.boxes):
                    continue

                xyxy  = det.boxes.xyxy.cpu().numpy().astype(float)
                clsid = det.boxes.cls.cpu().numpy().astype(int)
                confs = det.boxes.conf.cpu().numpy().astype(float)

                page = doc[page_idx]
                for (x1, y1, x2, y2), cid, conf in zip(xyxy, clsid, confs):
                    if cid not in wanted:
                        continue
                    rect = fitz.Rect(x1/_SCALE, y1/_SCALE, x2/_SCALE, y2/_SCALE)
                    txt = _clean_text(page.get_text("text", clip=rect))
                    if not txt:
                        continue

                    title_candidates.append({
                        "page": page_idx,  # 0-based
                        "text": txt,
                        "conf": float(conf),
                        "x1_px": float(x1), "y1_px": float(y1),
                        "x2_px": float(x2), "y2_px": float(y2),
                        "h_px": float(y2 - y1),
                        "y_top_px": float(y1),
                        "label_name": str(names.get(int(cid), cid)),
                    })
            finally:
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
    finally:
        doc.close()

    if not title_candidates:
        return {"title": "", "outline": []}

    # Dedup per (page, text) keeping highest confidence
    dedup = {}
    for c in title_candidates:
        k = (c["page"], c["text"].lower())
        if k not in dedup or c["conf"] > dedup[k]["conf"]:
            dedup[k] = c
    cands = list(dedup.values())

    # Pick doc title = largest height, then higher conf, then earliest page, then top-most
    doc_title = ""
    if cands:
        t = sorted(
            cands,
            key=lambda c: (c["h_px"], c["conf"], -c["page"], -c["y_top_px"]),
            reverse=True
        )[0]
        doc_title = t["text"]
        # remove top title from outline
        cands = [c for c in cands if not (c["page"] == t["page"] and c["text"] == t["text"])]

    if not cands:
        return {"title": doc_title, "outline": []}

    levels = _cluster_levels_by_height(cands)
    for c, lvl in zip(cands, levels):
        c["level"] = lvl

    # Sort visually: page asc, top-to-bottom
    cands.sort(key=lambda c: (c["page"], c["y_top_px"]))

    outline = [{"level": c["level"], "text": c["text"], "page": c["page"]} for c in cands]
    return {"title": doc_title, "outline": outline}
