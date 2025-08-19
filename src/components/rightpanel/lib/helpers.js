// Shared helpers (pure JS)
import { API_BASE } from "../../../services/api";

export async function ragQuery(q, top_k = 10) {
  const r = await fetch(`${API_BASE}/api/rag/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q, top_k }),
  });
  if (!r.ok) throw new Error(`RAG ${r.status}`);
  return r.json();
}

export async function podcastPreview(payload) {
  const r = await fetch(`${API_BASE}/api/podcast/from-selection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Podcast preview ${r.status}`);
  return r.json();
}

export async function podcastSpeak(payload) {
  const r = await fetch(`${API_BASE}/api/podcast/from-selection/audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Podcast audio ${r.status}`);
  return r.blob();
}

export function niceName(pdf_name = "") {
  const parts = (pdf_name || "").split("_");
  return parts.length > 1 ? parts.slice(1).join("_") : (pdf_name || "document.pdf");
}

function looksLikeExample(t = "") {
  return /\b(e\.g\.|for example|for instance|example:|e\.g,)\b/i.test(t) || /\d{2,}/.test(t) || /•|- |\d+\)/.test(t);
}
function looksLikeDefinition(t = "") {
  return /\b(is defined as|refers to|means\b|definition of)\b/i.test(t);
}
function looksLikeContradiction(t = "") {
  return /\b(however|but|in contrast|whereas|on the other hand|contradict|conflict|opposite)\b/i.test(t);
}

export function bucketize(selection, contexts = []) {
  if (!contexts?.length) {
    return { overlapping: [], contradictory: [], examples: [], definitions: [], related: [] };
  }
  const byScore = [...contexts].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const cutoff = byScore[Math.max(0, Math.floor(byScore.length * 0.3) - 1)]?.score ?? 0;

  const buckets = { overlapping: [], contradictory: [], examples: [], definitions: [], related: [] };
  for (const c of contexts) {
    const txt = (c.text || "").trim();
    if ((c.score ?? 0) >= cutoff) { buckets.overlapping.push(c); continue; }
    if (looksLikeContradiction(txt)) { buckets.contradictory.push(c); continue; }
    if (looksLikeExample(txt)) { buckets.examples.push(c); continue; }
    if (looksLikeDefinition(txt)) { buckets.definitions.push(c); continue; }
    buckets.related.push(c);
  }
  return buckets;
}
