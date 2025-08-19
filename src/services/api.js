import { uuid } from "../lib/utils";

// If you set REACT_APP_API_BASE=http://localhost:4000, requests bypass CRA proxy.
// If left empty (""), CRA proxy (package.json "proxy") will be used in dev.
export const API_BASE = process.env.REACT_APP_API_BASE || "";

export async function uploadToBackend(file) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error("upload failed");
  return r.json(); // { id, name, url, size, mimetype }
}

export function mapYolo(outline) {
  return (outline || []).map((h) => ({
    id: uuid(),
    level: h.level === "H1" ? 1 : h.level === "H2" ? 2 : 3,
    title: h.text,
    page: (h.page ?? 0) + 1, // backend 0-based -> Adobe 1-based
  }));
}

export function mapHeuristic(headings) {
  return (headings || []).map((h) => ({
    id: uuid(),
    level: h.level,
    title: h.title,
    page: h.page,
  }));
}

export async function detectHeadings(serverId) {
  // Try YOLO first
  try {
    const r = await fetch(`${API_BASE}/api/outline-yolo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: serverId }),
    });
    const data = await r.json();
    if (r.ok && data?.outline) return { ok: true, data: mapYolo(data.outline) };
  } catch {}

  // Fallback to heuristic
  try {
    const r2 = await fetch(`${API_BASE}/api/headings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: serverId }),
    });
    const data2 = await r2.json();
    if (r2.ok && data2?.headings) return { ok: true, data: mapHeuristic(data2.headings) };
  } catch {}

  return { ok: false };
}

export async function deleteFromBackend(serverId) {
  if (!serverId) return; // No server ID means file wasn't uploaded to backend
  
  try {
    const response = await fetch(`${API_BASE}/api/files/${serverId}`, {
      method: "DELETE",
    });
    
    if (!response.ok) {
      console.warn(`Failed to delete file ${serverId} from backend:`, response.statusText);
      return { success: false, error: response.statusText };
    }
    
    const result = await response.json();
    console.log(`Successfully deleted file ${serverId}, removed ${result.removed_chunks} chunks from RAG index`);
    return result;
  } catch (error) {
    console.warn(`Error deleting file ${serverId} from backend:`, error);
    return { success: false, error: error.message };
  }
}
