// src/components/CenterViewer.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Download } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import SelectionAnchor from "./SelectionAnchor";

/* Stable worker setup for CRA/Webpack */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export default function CenterViewer({ activeFile, onReady, onStatus }) {
  const containerRef = useRef(null);
  const [numPages, setNumPages] = useState(null);
  const [page, setPage] = useState(1);
  const [fitMode, setFitMode] = useState("width"); // width | page
  const [containerWidth, setContainerWidth] = useState(0);

  // Report status upward (for StatusBar)
  useEffect(() => {
    onStatus?.({ page, fit: fitMode });
  }, [page, fitMode, onStatus]);

  // Expose API to parent (Sidebar uses gotoPage)
  useEffect(() => {
    const api = {
      gotoPage: (p) => setPage(Math.max(1, Math.min(numPages || Infinity, parseInt(p, 10) || 1))),
      search: () => {},
    };
    onReady?.(api);
    return () => onReady?.(null);
  }, [numPages, onReady]);

  // Reset when switching files
  useEffect(() => {
    setPage(1);
  }, [activeFile?.id]);

  // Track container width for "fit width"
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(Math.floor(entries[0].contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onDocLoad = useCallback(({ numPages }) => setNumPages(numPages), []);
  const pageWidth = fitMode === "width" ? Math.max(320, containerWidth) : undefined;

  // Let pdf.js fetch by URL (prevents StrictMode buffer-detach issues).
  // Add a cache-buster so dev hot reloads always refetch cleanly.
  const fileSpec = useMemo(() => {
    if (!activeFile?.url) return null;
    const bust = Date.now();
    const url =
      activeFile.url + (activeFile.url.includes("?") ? `&t=${bust}` : `?t=${bust}`);
    return { url, withCredentials: false };
  }, [activeFile?.url]);

  if (!activeFile) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-neutral-950 text-slate-300">
        <div className="text-center">
          <div className="text-sm">
            Drop a PDF or click <span className="font-medium">New</span>.
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Text selection enabled · anchor appears beside selection
          </div>
        </div>
      </div>
    );
  }

  return (
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
              setPage(Math.max(1, Math.min(numPages || 1, parseInt(e.target.value || "1", 10))))
            }
            className="w-16 bg-transparent border border-neutral-700 focus:border-neutral-500 outline-none rounded px-2 py-1 text-slate-200"
            inputMode="numeric"
            pattern="[0-9]*"
          />

          <select
            value={fitMode}
            onChange={(e) => setFitMode(e.target.value)}
            className="bg-transparent border border-neutral-700 focus:border-neutral-500 outline-none rounded px-2 py-1 text-slate-200"
            title="Fit"
          >
            <option value="width">Fit width</option>
            <option value="page">Fit page</option>
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

      {/* Viewer with text selection + anchor popover */}
      <div ref={containerRef} className="relative flex-1 min-h-0 overflow-auto">
        {fileSpec ? (
          <Document
            file={fileSpec}
            onLoadSuccess={onDocLoad}
            onLoadError={(e) => console.error("react-pdf load error:", e)}
            onSourceError={(e) => console.error("react-pdf source error:", e)}
            loading={<DocLoading />}
            error={<DocError />}
            noData={<DocError text="No PDF data" />}
          >
            <Page
              pageNumber={page}
              width={pageWidth}
              renderTextLayer
              renderAnnotationLayer={false}
              className="mx-auto my-4 shadow-sm"
            />
          </Document>
        ) : (
          <DocError text="No PDF URL" />
        )}

        {/* Anchor next to selected text */}
        <SelectionAnchor
          containerRef={containerRef}
          onCreate={({ text }) => {
            const link = `${window.location.origin}${window.location.pathname}?doc=${encodeURIComponent(
              activeFile.id
            )}&page=${page}`;
            navigator.clipboard?.writeText(link).catch(() => {});
            console.log("Anchor:", { text, page, link });
          }}
        />
      </div>
    </div>
  );
}

function DocLoading() {
  return (
    <div className="w-full h-full grid place-items-center text-slate-400 text-xs">
      Loading PDF…
    </div>
  );
}

function DocError({ text = "Failed to load PDF file." }) {
  return (
    <div className="w-full h-full grid place-items-center text-slate-400 text-sm">
      {text}
    </div>
  );
}
