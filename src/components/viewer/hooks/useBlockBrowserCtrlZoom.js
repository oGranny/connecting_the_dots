import { useEffect } from "react";

function inside(e) {
  const target = e.target;
  return target && target.closest && !!target.closest(".pdf-viewer");
}

export default function useBlockBrowserCtrlZoom(elementRef) {
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    console.log("Setting up browser zoom blocking on element:", el);

    // TEMPORARILY DISABLED - let's see if this is interfering
    return;

    // Block Ctrl+Wheel - but let it through if it's on our PDF viewer
    const onWheelCapture = (e) => {
      if (e.ctrlKey) {
        if (inside(e)) {
          // Don't block - let our custom zoom handle it
          console.log("Allowing custom zoom handling");
          return;
        } else {
          // Block browser zoom outside our viewer
          console.log("Blocking browser wheel zoom outside viewer");
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    // Block Ctrl/⌘ + (+/-/0) keyboard shortcuts
    const onKeyDownCapture = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (["+", "=", "-", "_", "0"].includes(k) || e.code.startsWith("Numpad")) {
        if (inside(e) || document.activeElement === document.body) {
          console.log("Blocking browser keyboard zoom:", k);
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    // Add event listeners at the document level with capture: true
    document.addEventListener("wheel", onWheelCapture, { capture: true, passive: false });
    document.addEventListener("keydown", onKeyDownCapture, { capture: true, passive: false });

    console.log("Browser zoom blocking event listeners added");

    return () => {
      document.removeEventListener("wheel", onWheelCapture, { capture: true });
      document.removeEventListener("keydown", onKeyDownCapture, { capture: true });
      console.log("Browser zoom blocking event listeners removed");
    };
  }, [elementRef]);
}
