// src/components/viewer/hooks/useZoomInteractions.js
import { useEffect } from "react";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export default function useZoomInteractions(elementRef, setZoom, options = {}) {
  const { min = 0.25, max = 4, sensitivity = 0.002 } = options;

  useEffect(() => {
    const el = elementRef.current;
    if (!el) {
      console.log("No element reference found for zoom interactions");
      return;
    }

    console.log("Setting up zoom interactions on element:", el.className);

    // Simple Ctrl+Wheel zoom handler
    const onWheel = (e) => {
      // Log every wheel event to see what we get
      if (e.ctrlKey) {
        console.log("Ctrl+Wheel detected:", { 
          deltaY: e.deltaY, 
          target: e.target?.tagName,
          targetClass: e.target?.className,
          currentTarget: e.currentTarget?.className
        });
        
        // Prevent browser zoom immediately
        e.preventDefault();
        e.stopPropagation();
        
        const delta = -e.deltaY;
        const scale = 1 + (delta * sensitivity);
        
        console.log("Applying zoom:", { delta, scale });
        
        setZoom((currentZoom) => {
          const newZoom = clamp(currentZoom * scale, min, max);
          console.log("Zoom updated:", currentZoom, "->", newZoom);
          return newZoom;
        });
      }
    };

    // Also add a global listener to catch all events
    const onGlobalWheel = (e) => {
      if (e.ctrlKey) {
        console.log("Global Ctrl+Wheel detected, target:", e.target?.tagName, e.target?.className);
        
        // Check if we're inside the PDF viewer
        const pdfViewer = e.target?.closest?.('.pdf-viewer');
        if (pdfViewer) {
          console.log("Inside PDF viewer, handling zoom");
          e.preventDefault();
          e.stopPropagation();
          
          const delta = -e.deltaY;
          const scale = 1 + (delta * sensitivity);
          
          setZoom((currentZoom) => {
            const newZoom = clamp(currentZoom * scale, min, max);
            console.log("Global zoom updated:", currentZoom, "->", newZoom);
            return newZoom;
          });
        }
      }
    };

    // Add listeners to both the element and document
    el.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("wheel", onGlobalWheel, { passive: false });

    console.log("Zoom event listeners added to element and document");

    // Cleanup
    return () => {
      el.removeEventListener("wheel", onWheel);
      document.removeEventListener("wheel", onGlobalWheel);
      console.log("Zoom event listeners removed");
    };
  }, [elementRef, setZoom, min, max, sensitivity]);
}
