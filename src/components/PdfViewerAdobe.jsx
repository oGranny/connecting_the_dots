import React, { useEffect, useMemo, useRef } from "react";
import useAdobeViewSDKReady from "../hooks/useAdobeViewSDKReady";
import { uuid } from "../lib/utils";

export default function PdfViewerAdobe({ file, onReady }) {
  const ready = useAdobeViewSDKReady();
  const containerRef = useRef(null);
  const containerId = useMemo(() => `adobe-view-${uuid()}`, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (!file) {
      el.innerHTML = "";
      return;
    }
    if (!ready) return;

    const clientId = process.env.REACT_APP_ADOBE_CLIENT_ID || "<YOUR_ADOBE_CLIENT_ID>";
    const adobeDCView = new window.AdobeDC.View({ clientId, divId: containerId });

    (async () => {
      try {
        let arrayBuffer;
        if (file.url) {
          const res = await fetch(file.url);
          arrayBuffer = await res.arrayBuffer();
        } else if (file.file?.arrayBuffer) {
          arrayBuffer = await file.file.arrayBuffer();
        } else {
          return;
        }

        const viewer = await adobeDCView.previewFile(
          {
            content: { promise: Promise.resolve(arrayBuffer) },
            metaData: { fileName: file.name || "document.pdf" },
          },
          {
            embedMode: "IN_LINE",
            defaultViewMode: "FIT_WIDTH",
            showDownloadPDF: true,
            showPrintPDF: true,
          }
        );

        const apis = await viewer.getAPIs();

        const gotoPage = async (pageNumber, x = 0, y = 0) => {
          try {
            if (typeof apis.gotoLocation === "function") {
              try {
                await apis.gotoLocation({ pageNumber, x, y });
              } catch {
                await apis.gotoLocation(pageNumber, x, y);
              }
            } else if (typeof apis.goToLocation === "function") {
              await apis.goToLocation({ pageNumber, x, y });
            }
          } catch (e) {
            console.warn("gotoPage failed", e);
          }
        };

        const search = async (q) => {
          try {
            if (typeof apis.search === "function") return apis.search(q);
            if (typeof apis.getSearchAPIs === "function") {
              const s = apis.getSearchAPIs();
              return s.search(q);
            }
          } catch (e) {
            console.warn("search failed", e);
          }
        };

        onReady?.({ gotoPage, search });
      } catch (e) {
        console.error("Adobe viewer failed:", e);
      }
    })();

    return () => {
      if (el) el.innerHTML = "";
    };
  }, [ready, file, containerId, onReady]);

  return <div ref={containerRef} id={containerId} className="w-full" />;
}
