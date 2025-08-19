import React, { useEffect, useRef, useState } from "react";
import { Play, Pause, Download } from "lucide-react";
import { cls } from "../../../lib/utils";

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AudioPlayer({ src, onDownload }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onLoaded = () => setDuration(a.duration || 0);
    const onTime = () => { if (!seeking) setCurrent(a.currentTime || 0); };
    const onEnd = () => setPlaying(false);
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
    };
  }, [seeking]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !src) return;
    setPlaying(true);
    a.play().catch(() => setPlaying(false));
  }, [src]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  const pct = duration ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0;

  return (
    <div className="w-full rounded-xl bg-white/5 p-3">
      <audio ref={audioRef} src={src ?? undefined} preload="metadata" />
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          disabled={!src}
          className={cls(
            "shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-full",
            "bg-white/90 hover:bg-white text-neutral-900",
            !src && "opacity-60 cursor-not-allowed"
          )}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>

        <div className="flex-1">
          <input
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={seeking ? undefined : current}
            onChange={(e) => { setSeeking(true); setCurrent(Number(e.target.value)); }}
            onMouseUp={(e) => { const a = audioRef.current; const t = Number(e.target.value); if (a) a.currentTime = t; setSeeking(false); }}
            onTouchEnd={(e) => { const a = audioRef.current; const t = Number(e.target.value); if (a) a.currentTime = t; setSeeking(false); }}
            className="w-full appearance-none bg-transparent"
            style={{
              background: `linear-gradient(to right, rgba(255,255,255,.7) ${pct}%, rgba(255,255,255,.12) ${pct}%)`,
              height: 4, borderRadius: 9999, outline: "none",
            }}
          />
          <div className="mt-1 flex justify-between text-[11px] text-slate-400">
            <span>{formatTime(current)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <button
          onClick={onDownload}
          disabled={!src}
          className={cls(
            "shrink-0 px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-100 text-xs border border-white/20",
            !src && "opacity-60 cursor-not-allowed"
          )}
        >
          <Download size={14} />
        </button>
      </div>
    </div>
  );
}
