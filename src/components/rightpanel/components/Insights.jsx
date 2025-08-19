import React from "react";
import { niceName } from "../lib/helpers";

export function Pill({ children }) {
  return <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-slate-200 border border-white/20">{children}</span>;
}

export function CtxRow({ ctx, activeFile }) {
  const title = `${niceName(ctx.pdf_name)} · p.${ctx.page}`;
  const canJump =
    activeFile?.name &&
    (ctx.pdf_name?.endsWith(activeFile.name) || niceName(ctx.pdf_name) === activeFile.name);

  const go = () => {
    if (!canJump) return;
    window.dispatchEvent(new CustomEvent("viewer:goto", { detail: { page: ctx.page, docId: activeFile.id } }));
  };

  return (
    <div className="p-2 rounded-xl bg-white/5 border border-white/20">
      <div className="flex items-center gap-2 text-xs text-slate-300">
        <span className="font-medium">{title}</span>
        {typeof ctx.score === "number" && (
          <span className="ml-auto text-[10px] text-slate-400">score {ctx.score.toFixed(3)}</span>
        )}
      </div>
      <div className="mt-1 text-sm text-slate-200 whitespace-pre-wrap">
        {ctx.text?.length > 600 ? ctx.text.slice(0, 600) + "…" : ctx.text}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {canJump ? (
          <button
            onClick={go}
            className="text-xs px-2 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-slate-100"
            title="Jump to this page in the viewer"
          >
            Go to page
          </button>
        ) : (
          <span className="text-[11px] text-slate-400">Open this PDF to enable jumping</span>
        )}
      </div>
    </div>
  );
}

export function BucketBlock({ title, items, activeFile }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-semibold text-slate-200">{title}</div>
      <div className="space-y-2">
        {items.map((c, i) => (
          <CtxRow key={`${c.chunk_id || c.page}-${i}`} ctx={c} activeFile={activeFile} />
        ))}
      </div>
    </div>
  );
}

export const EMPTY_BUCKETS = {
  overlapping: [], contradictory: [], examples: [], definitions: [], related: []
};

export function InsightsCard({ selection, answer, buckets = EMPTY_BUCKETS, activeFile }) {
  const {
    overlapping = [], contradictory = [], examples = [], definitions = [], related = []
  } = buckets || EMPTY_BUCKETS;
  return (
    <div className="text-slate-100">
      <div className="flex items-center gap-2 text-xs text-slate-300">
        <Pill>Insights</Pill>
        <span className="truncate">for "{selection?.slice(0, 120)}{selection?.length > 120 ? "…" : ""}"</span>
      </div>

      {answer && (
        <div className="mt-2 p-2 rounded-xl bg-white/5 border border-white/20 text-sm whitespace-pre-wrap">
          {answer}
        </div>
      )}

      <BucketBlock title="Overlapping / Closest" items={overlapping} activeFile={activeFile} />
      <BucketBlock title="Contradictory viewpoints" items={contradictory} activeFile={activeFile} />
      <BucketBlock title="Examples & use-cases" items={examples} activeFile={activeFile} />
      <BucketBlock title="Definitions" items={definitions} activeFile={activeFile} />
      <BucketBlock title="Related" items={related} activeFile={activeFile} />
    </div>
  );
}
