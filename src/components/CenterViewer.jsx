import React from "react";
import useGrabScroll from "../hooks/useGrabScroll";
import PdfViewerAdobe from "./PdfViewerAdobe";
import { Upload } from "lucide-react";

export default function CenterViewer({ activeFile, onReady }) {
  const grab = useGrabScroll();
  return (
    <div
      className={`flex-1 min-h-0 scroll-area overflow-x-hidden ${grab.className}`}
      onMouseDown={grab.onMouseDown}
      onMouseMove={grab.onMouseMove}
      onMouseUp={grab.onMouseUp}
      onMouseLeave={grab.onMouseLeave}
    >
      <div className="pb-12">
        {activeFile ? (
          <PdfViewerAdobe file={activeFile} onReady={onReady} />
        ) : (
          <div className="h-full w-full grid place-items-center text-center text-slate-300 py-16">
            <div>
              <div className="mx-auto w-14 h-14 grid place-items-center rounded-2xl bg-slate-800 border border-slate-700 mb-3">
                <Upload />
              </div>
              <p className="text-sm">
                Drop a PDF here or click <span className="font-medium">New</span> to upload.
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Uses Adobe PDF Embed (Inline). The center column scrolls vertically.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
