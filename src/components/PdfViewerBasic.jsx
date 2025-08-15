import React, { useEffect, useMemo, useRef } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

// Disable external worker and run PDF.js in main thread to avoid cross-origin issues during development
GlobalWorkerOptions.workerSrc = ""; // no external worker

export default function PdfViewerBasic({ file, onReady }) {
  const containerRef = useRef(null);
  const canvasesRef = useRef([]);
  const docRef = useRef(null);
  const pendingPageRef = useRef(null);

  const urlOrData = useMemo(() => {
    if (!file) return null;
    if (file.url) return { url: file.url };
    if (file.file?.arrayBuffer) return { dataPromise: file.file.arrayBuffer() };
    return null;
  }, [file]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;

    async function load() {
      if (!urlOrData) {
        el.innerHTML = "";
        docRef.current = null;
        canvasesRef.current = [];
        return;
      }

      // Prepare data
      let loadingTask;
      if (urlOrData.url) {
        loadingTask = getDocument({ url: urlOrData.url, disableWorker: true });
      } else if (urlOrData.dataPromise) {
        const buf = await urlOrData.dataPromise;
        loadingTask = getDocument({ data: new Uint8Array(buf), disableWorker: true });
      }

      try {
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        docRef.current = pdf;

        // Clear and render pages
        el.innerHTML = "";
        canvasesRef.current = new Array(pdf.numPages);

        for (let i = 1; i <= pdf.numPages; i++) {
          const pageDiv = document.createElement("div");
          pageDiv.style.display = "grid";
          pageDiv.style.placeItems = "center";
          pageDiv.style.padding = "12px 0";
          const canvas = document.createElement("canvas");
          canvas.style.maxWidth = "100%";
          canvas.style.height = "auto";
          pageDiv.appendChild(canvas);
          el.appendChild(pageDiv);
          canvasesRef.current[i - 1] = canvas;

          const page = await pdf.getPage(i);
          const scale = calcFitWidthScale(page, el.clientWidth - 24);
          await renderPageToCanvas(page, canvas, scale);
        }

        // Expose API
        const gotoPage = async (pageNumber) => {
          if (!docRef.current) return;
          const n = Math.max(1, Math.min(pageNumber | 0, docRef.current.numPages));
          const target = canvasesRef.current[n - 1];
          if (target?.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
        };
        const search = async () => {};
        onReady?.({ gotoPage, search });

        // If there was a queued page jump before ready
        if (pendingPageRef.current != null) {
          const p = pendingPageRef.current;
          pendingPageRef.current = null;
          await gotoPage(p);
        }
      } catch (e) {
        console.error("PDF.js load error", e);
        el.innerHTML = "";
        onReady?.(null);
      }
    }

    load();

    function onResize() {
      // Re-render pages on container resize for fit-width
      if (!docRef.current) return;
      (async () => {
        const pdf = docRef.current;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const canvas = canvasesRef.current[i - 1];
          if (!canvas) continue;
          const scale = calcFitWidthScale(page, el.clientWidth - 24);
          await renderPageToCanvas(page, canvas, scale);
        }
      })();
    }

    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      el.innerHTML = "";
      docRef.current?.destroy?.();
      docRef.current = null;
      canvasesRef.current = [];
    };
  }, [urlOrData, onReady]);

  return (
    <div ref={containerRef} className="w-full max-w-[1200px] mx-auto" />
  );
}

function calcFitWidthScale(page, targetWidth) {
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.max(0.1, (targetWidth || viewport.width) / viewport.width);
  return scale;
}

async function renderPageToCanvas(page, canvas, scale) {
  const viewport = page.getViewport({ scale });
  const ctx = canvas.getContext("2d", { alpha: false });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  await page.render({ canvasContext: ctx, viewport }).promise;
}

