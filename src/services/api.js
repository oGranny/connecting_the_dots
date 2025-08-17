// services/api.js
export const API_BASE = process.env.REACT_APP_API_BASE || "";

// ---------- helpers ----------
async function postJSON(url, body, { timeoutMs = 45000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, json };
  } finally {
    clearTimeout(t);
  }
}

function pickHeadings(json) {
  // Backend may return { ok, data: [...] } or legacy { headings: [...] }
  const arr = Array.isArray(json?.data)
    ? json.data
    : (Array.isArray(json?.headings) ? json.headings : []);
  return Array.isArray(arr) ? arr : [];
}

// Normalize level/page so UI renders proper hierarchy
function coerceLevel(lv) {
  // Accept: 1, "1", "H1", "h1"
  if (typeof lv === "string") {
    const m = /^h?(\d)$/i.exec(lv.trim());
    if (m) {
      const n = parseInt(m[1], 10);
      return Math.max(1, Math.min(4, n));
    }
  }
  const n = Number(lv);
  if (Number.isFinite(n)) return Math.max(1, Math.min(4, n | 0));
  return 1;
}

function coercePage(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return 1;
  // Our backend returns 1-based. If an older endpoint returns 0-based, bump it.
  return n >= 1 ? n : n + 1;
}

function normalizeHeadings(arr) {
  return (arr || []).map((h, i) => ({
    id: h.id ?? `h-${i}-${Date.now()}`,
    level: coerceLevel(h.level ?? h.tag ?? h.h_level ?? h.depth),
    title: h.title ?? h.text ?? h.name ?? "",
    page: coercePage(h.page ?? h.page_num ?? h.p),
  }));
}

// ---------- API ----------
export async function uploadToBackend(file) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error("upload failed");
  return r.json(); // { id, name, url, size, mimetype }
}

/**
 * Detect headings (YOLO only).
 * Always calls backend with prefer: "yolo" and does NOT fall back.
 */
export async function detectHeadings(fileId) {
  try {
    const { ok, json } = await postJSON(
      `${API_BASE}/api/headings`,
      { id: fileId, prefer: "yolo" },
      { timeoutMs: 60000 }
    );
    const raw = pickHeadings(json);
    const data = normalizeHeadings(raw);
    return { ok: ok && Array.isArray(raw), data, source: "yolo" };
  } catch (_) {
    return { ok: false, data: [], source: "yolo" };
  }
}