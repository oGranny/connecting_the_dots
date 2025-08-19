import React, { useEffect, useRef, useState } from "react";
import { Headphones, Play } from "lucide-react";
import { cls } from "../../../lib/utils";
import AudioPlayer from "./AudioPlayer";
import { podcastPreview, podcastSpeak } from "../lib/helpers";
import { CtxRow } from "./Insights";

export default function PodcastPanel({ activeFile, lastSelection, onWorkingChange }) {
  const [selection, setSelection] = useState(lastSelection || "");
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState(null);

  const [audioUrl, setAudioUrl] = useState(null);
  const [contexts, setContexts] = useState([]);

  // notify parent so it can show a badge on the tab
  useEffect(() => {
    if (typeof onWorkingChange === "function") onWorkingChange(isWorking);
  }, [isWorking, onWorkingChange]);

  // keep selection synced with viewer
  useEffect(() => {
    function handleAnchor(e) {
      const t = (e.detail?.text || "").trim();
      if (t) setSelection(t);
    }
    window.addEventListener("doc-anchor", handleAnchor);
    return () => window.removeEventListener("doc-anchor", handleAnchor);
  }, []);
  useEffect(() => { if (lastSelection) setSelection(lastSelection); }, [lastSelection]);

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  async function generate() {
    const sel = (selection || "").trim();
    if (!sel) {
      setError("Select text in the PDF first (same as Insights).");
      return;
    }
    setError(null);
    setIsWorking(true);
    setContexts([]);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);

    const payload = { selection: sel, top_k: 7, minutes: 3 }; // fixed defaults

    try {
      const preview = await podcastPreview(payload);
      setContexts(preview.contexts || []);

      const blob = await podcastSpeak(payload);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setIsWorking(false);
    }
  }

  const download = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = "podcast.mp3";
    a.click();
  };

  return (
    <div className="text-slate-100">
      {/* centered hero (no outer card) */}
      <div className="flex flex-col items-center text-center">
        <div className="rounded-2xl p-5 bg-white/5 border border-white/20 mt-2">
          <Headphones size={64} />
        </div>

        <div className="mt-3 text-sm text-slate-300">
          Turn your Anchor into a quick podcast episode
        </div>
        <div className="text-xs text-slate-400 mt-2">
          AI-generated; may contain errors.
        </div>

        <button
          onClick={generate}
          disabled={isWorking}
          className={cls(
            "mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/90 hover:bg-white text-neutral-900 text-sm",
            isWorking && "opacity-60 cursor-not-allowed"
          )}
        >
          <Play size={16} />
          {isWorking ? "Working…" : "Generate Podcast"}
        </button>

        {error && <div className="text-xs text-red-300 mt-2">{error}</div>}
      </div>

      {/* player */}
      <div className="mt-4">
        <AudioPlayer src={audioUrl} onDownload={download} />
      </div>

      {/* References */}
      {contexts?.length ? (
        <div className="mt-6">
          <div className="text-xs font-semibold text-slate-200 mb-1">References & Context</div>
          <div className="space-y-2">
            {contexts.map((c, i) => <CtxRow key={`ctx-${i}`} ctx={c} activeFile={activeFile} />)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
