// src/components/SelectionAnchor.jsx
import React, { useEffect, useState } from "react";
import { Link2 } from "lucide-react";

/**
 * Floating "anchor" button that appears next to the current text selection
 * inside the given container (e.g., the react-pdf scroll area).
 */
export default function SelectionAnchor({ containerRef, onCreate }) {
  const [pos, setPos] = useState(null); // { top, left }
  const [selectionText, setSelectionText] = useState("");

  useEffect(() => {
    const hostEl = containerRef?.current;
    if (!hostEl) return;

    const updateFromSelection = () => {
      const sel = window.getSelection?.();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setPos(null);
        setSelectionText("");
        return;
      }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const host = hostEl.getBoundingClientRect();

      // Only show if selection intersects our container
      const intersects =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > host.top &&
        rect.top < host.bottom &&
        rect.right > host.left &&
        rect.left < host.right;

      if (!intersects) {
        setPos(null);
        setSelectionText("");
        return;
      }

      // Position to the right of the selection, clamp inside host
      const top = Math.max(0, rect.top - host.top - 6);
      const left = Math.min(
        host.width - 28,
        Math.max(0, rect.left - host.left + rect.width + 8)
      );

      setPos({ top, left });
      setSelectionText(sel.toString().trim());
    };

    const onMouseUp = () => setTimeout(updateFromSelection, 0);
    const onKeyUp = () => setTimeout(updateFromSelection, 0);
    const onScroll = () => setTimeout(updateFromSelection, 0);

    document.addEventListener("selectionchange", updateFromSelection);
    hostEl.addEventListener("mouseup", onMouseUp);
    hostEl.addEventListener("keyup", onKeyUp);
    hostEl.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      document.removeEventListener("selectionchange", updateFromSelection);
      hostEl.removeEventListener("mouseup", onMouseUp);
      hostEl.removeEventListener("keyup", onKeyUp);
      hostEl.removeEventListener("scroll", onScroll);
    };
  }, [containerRef]);

  if (!pos || !selectionText) return null;

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onCreate?.({ text: selectionText });
    // Hide the button but keep the selection
    setPos(null);
  };

  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep selection
      onClick={handleClick}
      style={{ top: pos.top, left: pos.left }}
      className="absolute z-50 w-7 h-7 grid place-items-center rounded-md
                 bg-black/70 hover:bg-black/85 text-white border border-white/10
                 shadow-lg backdrop-blur"
      title="Create anchor from selection"
    >
      <Link2 size={14} />
    </button>
  );
}
    