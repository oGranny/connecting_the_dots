import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { cls } from "../../../lib/utils";

export default function TopTabs({ tab, setTab, podcastWorking }) {
  const tabs = [
    { id: "insights", label: "Insights" },
    { id: "podcast", label: "Podcast" },
    { id: "chat", label: "Chat" },
  ];
  const wrapRef = useRef(null);
  const btnRefs = useRef({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const updateIndicator = useCallback(() => {
    const wrap = wrapRef.current;
    const btn = btnRefs.current[tab];
    if (!wrap || !btn) return;
    const wRect = wrap.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    setIndicator({ left: bRect.left - wRect.left, width: bRect.width });
  }, [tab]);

  useLayoutEffect(() => { updateIndicator(); }, [updateIndicator]);
  useEffect(() => {
    const onResize = () => updateIndicator();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateIndicator]);

  const onKeyDown = (e) => {
    const idx = tabs.findIndex((t) => t.id === tab);
    if (e.key === "ArrowRight") {
      const next = tabs[(idx + 1) % tabs.length].id;
      setTab(next); requestAnimationFrame(updateIndicator); e.preventDefault();
    } else if (e.key === "ArrowLeft") {
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length].id;
      setTab(prev); requestAnimationFrame(updateIndicator); e.preventDefault();
    }
  };

  return (
    <div className="sticky top-0 z-10 bg-transparent border-b border-white/10">
      <div className="px-3 pt-2">
        <div ref={wrapRef} role="tablist" aria-label="Panels" className="relative" onKeyDown={onKeyDown}>
          <div aria-hidden className="absolute left-0 right-0 bottom-0 h-px bg-white/10" />
          <div aria-hidden className="absolute bottom-0 h-0.5 bg-slate-300 rounded-full transition-all duration-300 ease-out"
               style={{ left: indicator.left, width: indicator.width }} />
          <div className="flex gap-1">
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  ref={(el) => (btnRefs.current[t.id] = el)}
                  role="tab"
                  aria-selected={active}
                  aria-controls={`panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={cls(
                    "relative z-10 px-4 py-2 text-sm font-medium outline-none transition-colors",
                    active ? "text-white" : "text-slate-300 hover:text-white"
                  )}
                >
                  {t.label}
                  {t.id === "podcast" && podcastWorking && (
                    <span
                      aria-label="Generating podcast"
                      title="Generating podcast"
                      className="ml-2 inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse align-middle"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
