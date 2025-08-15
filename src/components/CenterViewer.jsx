// src/components/CenterViewer.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Upload, ExternalLink, Download } from "lucide-react";

/**
 * Browser-native PDF viewer (no Adobe / no PDF.js).
 * Exposes to parent via onReady:
 *  - gotoPage(n)
 *  - search(q)  // no-op for compatibility
 */
export default function CenterViewer({ activeFile, onReady }) {
  const [page, setPage] = useState(1);
  const [fit, setFit] = useState("page-width"); // 'page-width' | 'page-fit' | '' (some browsers ignore)

  // Provide API to App.jsx (Sidebar calls gotoPage)
  useEffect(() => {
    const api = {
      gotoPage: (p) => setPage(Math.max(1, parseInt(p, 10) || 1)),
      search: (_q) => {}, // native viewers don't expose programmatic search
    };
    onReady?.(api);
    return () => onReady?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset to first page when switching docs
  useEffect(() => {
    setPage(1);
  }, [activeFile?.id]);

  // Build the PDF open parameters
  const src = useMemo(() => {
    if (!activeFile?.url) return null;
    let hash = `#page=${page}`;
    if (fit) hash += `&zoom=${fit}`;
    return `${activeFile.url}${hash}`;
  }, [activeFile?.url, page, fit]);

  if (!activeFile) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-neutral-950 text-slate-300">
        <div className="text-center">
          <div className="mx-auto w-14 h-14 grid place-items-center rounded-2xl bg-slate-800 border border-slate-700 mb-3">
            <Upload />
          </div>
          <p className="text-sm">
            Drop a PDF here or click <span className="font-medium">New</span> to upload.
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Using the browser’s built-in viewer (Adobe-free).
          </p>
        </div>
      </div>
    );
  }

  return (
    // IMPORTANT: full-height, no extra padding. The parent is a flex column.
    <div className="flex-1 min-h-0 flex flex-col bg-neutral-950">
      {/* Toolbar */}
      <div className="h-10 px-3 border-b border-neutral-800 flex items-center gap-3 text-xs">
        <span className="truncate text-slate-300" title={activeFile.name}>
          {activeFile.name}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <label className="text-slate-400" htmlFor="pageInput">Page</label>
          <input
            id="pageInput"
            value={page}
            onChange={(e) =>
              setPage(Math.max(1, parseInt(e.target.value || "1", 10)))
            }
            className="w-16 bg-transparent border border-neutral-700 focus:border-neutral-500 outline-none rounded px-2 py-1 text-slate-200"
            inputMode="numeric"
            pattern="[0-9]*"
          />

          <select
            value={fit}
            onChange={(e) => setFit(e.target.value)}
            className="bg-transparent border border-neutral-700 focus:border-neutral-500 outline-none rounded px-2 py-1 text-slate-200"
            title="Fit"
          >
            <option value="page-width">Fit width</option>
            <option value="page-fit">Fit page</option>
            <option value="">Default</option>
          </select>

          <a
            className="px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500 text-slate-300 inline-flex items-center gap-1"
            href={activeFile.url}
            target="_blank"
            rel="noreferrer"
            title="Open in new tab"
          >
            <ExternalLink size={14} /> Open
          </a>
          <a
            className="px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500 text-slate-300 inline-flex items-center gap-1"
            href={activeFile.url}
            download={activeFile.name || "document.pdf"}
            title="Download"
          >
            <Download size={14} /> Download
          </a>
        </div>
      </div>

      {/* Viewer area — fills remaining height */}
      <div className="flex-1 min-h-0">
        {src ? (
          <iframe
            key={activeFile.id}
            title={activeFile.name}
            src={src}
            className="w-full h-full border-0"
          />
        ) : (
          <div className="p-6 text-sm text-slate-400">Unable to preview this file.</div>
        )}
      </div>
    </div>
  );
}
