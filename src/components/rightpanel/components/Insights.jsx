import React, { useState, useEffect, useCallback, useRef } from "react";
import { Send, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { cls } from "../../../lib/utils";
import { ragQuery, bucketize, niceName } from "../lib/helpers";
import TopTabs from "./TopTabs";
import PodcastPanel from "./PodcastPanel";

const EMPTY_BUCKETS = { overlapping: [], contradictory: [], examples: [], definitions: [], related: [] };

function Pill({ children }) {
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-slate-200 border border-white/20">
      {children}
    </span>
  );
}

// Simple markdown renderer for AI answers
function MarkdownText({ text }) {
  if (!text) return null;

  // Split text into lines and process markdown
  const lines = text.split('\n');
  const elements = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Handle headers
    if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
      const headerText = line.slice(2, -2);
      elements.push(
        <div key={i} className="font-bold text-slate-100 mt-4 mb-2 text-sm">
          {headerText}
        </div>
      );
      continue;
    }
    
    // Handle bold text inline
    if (line.includes('**')) {
      const parts = line.split(/\*\*(.*?)\*\*/g);
      const rendered = parts.map((part, idx) => 
        idx % 2 === 1 ? <strong key={idx} className="font-semibold text-slate-100">{part}</strong> : part
      );
      elements.push(<div key={i} className="mb-1">{rendered}</div>);
      continue;
    }
    
    // Handle empty lines
    if (line.trim() === '') {
      elements.push(<div key={i} className="h-2"></div>);
      continue;
    }
    
    // Regular text
    elements.push(<div key={i} className="mb-1">{line}</div>);
  }
  
  return <div className="text-sm leading-relaxed text-slate-200">{elements}</div>;
}

export function InsightsLoading() {
  return (
    <div className="text-slate-100 animate-pulse">
      <div className="flex items-center gap-2 text-xs text-slate-300">
        <Loader2 size={16} className="animate-spin" />
        <span>Generating insights...</span>
      </div>
      <div className="mt-3 space-y-2">
        <div className="h-3 w-full bg-white/10 rounded"></div>
        <div className="h-3 w-4/5 bg-white/10 rounded"></div>
        <div className="h-3 w-3/5 bg-white/10 rounded"></div>
      </div>
    </div>
  );
}

export function CtxRow({ ctx, activeFile, onFileSelect, files }) {
  const title = `${niceName(ctx.pdf_name)} · p.${ctx.page}`;
  const isCurrentFile = activeFile?.name &&
    (ctx.pdf_name?.endsWith(activeFile.name) || niceName(ctx.pdf_name) === activeFile.name);
  
  const go = () => {
    if (isCurrentFile) {
      // Jump to page in current PDF and trigger precise highlight
      window.dispatchEvent(
        new CustomEvent("viewer:goto", { 
          detail: { 
            page: ctx.page, 
            docId: activeFile.id
          } 
        })
      );
      
      // Trigger precise highlighting using start/end positions
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("viewer:highlight-range", { 
            detail: { 
              page: ctx.page,
              start: ctx.start, // Character start position
              end: ctx.end,     // Character end position
              text: ctx.text,   // The actual text (for fallback)
              highlightColor: 'rgba(59, 130, 246, 0.3)' // Light blue
            } 
          })
        );
      }, 200);
      
    } else {
      // Find the target file with better matching logic
      const targetFile = files?.find(f => {
        // Direct name match
        if (f.name === ctx.pdf_name) return true;
        
        // Remove hash prefix from context filename and compare
        const cleanContextName = ctx.pdf_name?.replace(/^[a-f0-9]{32}_/, '');
        
        // Also convert underscores to spaces for better matching
        const normalizedContextName = cleanContextName?.replace(/_/g, ' ');
        
        // Try all variations
        if (f.name === cleanContextName) return true;
        if (f.name === normalizedContextName) return true;
        if (cleanContextName?.endsWith(f.name)) return true;
        if (normalizedContextName?.endsWith(f.name)) return true;
        if (f.name.endsWith(cleanContextName)) return true;
        if (f.name.endsWith(normalizedContextName)) return true;
        
        // Try with niceName (removes extension and cleans up)
        const nice1 = niceName(ctx.pdf_name);
        const nice2 = niceName(f.name);
        if (nice1 === nice2) return true;
        
        // Partial matches
        if (ctx.pdf_name?.includes(f.name)) return true;
        if (f.name.includes(cleanContextName || ctx.pdf_name)) return true;
        if (f.name.includes(normalizedContextName || ctx.pdf_name)) return true;
        
        return false;
      });

      if (targetFile && onFileSelect) {
        console.log(`Switching to file: ${targetFile.name} (ID: ${targetFile.id}), page: ${ctx.page}`);
        
        // Store the target data for highlighting
        const targetPage = ctx.page;
        const targetDocId = targetFile.id;
        const targetStart = ctx.start;
        const targetEnd = ctx.end;
        const targetText = ctx.text;
        
        // Listen for when the new PDF is ready
        const handleViewerReady = () => {
          console.log(`PDF loaded, jumping to page ${targetPage} and highlighting range ${targetStart}-${targetEnd}`);
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("viewer:goto", { 
                detail: { 
                  page: targetPage, 
                  docId: targetDocId
                } 
              })
            );
            
            // Trigger precise highlighting after navigation
            setTimeout(() => {
              window.dispatchEvent(
                new CustomEvent("viewer:highlight-range", { 
                  detail: { 
                    page: targetPage,
                    start: targetStart,
                    end: targetEnd,
                    text: targetText,
                    highlightColor: 'rgba(59, 130, 246, 0.3)'
                  } 
                })
              );
            }, 300);
            
          }, 100);
          
          // Remove the listener after use
          window.removeEventListener("viewer:ready", handleViewerReady);
        };
        
        // Add listener before switching files
        window.addEventListener("viewer:ready", handleViewerReady);
        
        // Switch to the target file
        onFileSelect(targetFile.id);
        
        // Fallback: try to jump and highlight after a longer delay
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("viewer:goto", { 
              detail: { 
                page: targetPage, 
                docId: targetDocId
              } 
            })
          );
          
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("viewer:highlight-range", { 
                detail: { 
                  page: targetPage,
                  start: targetStart,
                  end: targetEnd,
                  text: targetText,
                  highlightColor: 'rgba(59, 130, 246, 0.3)'
                } 
              })
            );
          }, 500);
          
          // Clean up listener
          window.removeEventListener("viewer:ready", handleViewerReady);
        }, 1000);
        
      } else {
        console.warn(`Could not find PDF file: ${ctx.pdf_name}`);
        console.log('Available files:', files?.map(f => ({ name: f.name, id: f.id })));
        console.log('Context data:', { start: ctx.start, end: ctx.end, page: ctx.page });
      }
    }
  };

  // Show a concise preview instead of full text
  const preview = ctx.text?.length > 150 ? ctx.text.slice(0, 150) + "…" : ctx.text;

  return (
    <div 
      className="px-2 py-1 rounded-md cursor-pointer bg-slate-800/30 hover:bg-slate-700/50 transition-colors"
      onClick={go}
      title={`Click to ${isCurrentFile ? 'jump to' : 'switch to'} ${title} and highlight text`}
    >
      <div className="flex items-center gap-2 text-xs text-slate-300">
        <span className="font-medium">{title}</span>
        {typeof ctx.score === "number" && (
          <span className="ml-auto text-[10px] text-slate-400">
            {(ctx.score*100).toFixed(0)}%
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-slate-400 italic">
        "{preview}"
      </div>
      <div className="mt-1 text-[10px] text-slate-500">
        {isCurrentFile ? '→ Jump & highlight' : '→ Switch PDF, jump & highlight'}
        {ctx.start !== undefined && ctx.end !== undefined && (
          <span className="ml-1 text-slate-600">({ctx.start}-{ctx.end})</span>
        )}
      </div>
    </div>
  );
}

function BucketBlock({ title, items, activeFile, onFileSelect, files }) {
  const [expanded, setExpanded] = useState(false);
  
  if (!items?.length) return null;
  
  // Show top 2 by default, all when expanded
  const displayItems = expanded ? items : items.slice(0, 2);
  const hasMore = items.length > 2;

  return (
    <div className="mt-3">
      <div className="mb-2 text-sm font-semibold text-slate-200 flex items-center gap-2">
        {title}
        <span className="text-xs text-slate-400 font-normal">({items.length})</span>
      </div>
      <div className="space-y-2">
        {displayItems.map((c, i) => (
          <CtxRow 
            key={`${c.chunk_id || c.page}-${i}`} 
            ctx={c} 
            activeFile={activeFile} 
            onFileSelect={onFileSelect}
            files={files}
          />
        ))}
        {hasMore && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-slate-400 px-2 py-1 italic hover:text-slate-300 hover:bg-slate-800/30 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
          >
            {expanded ? (
              <>
                <ChevronUp size={12} />
                Show less
              </>
            ) : (
              <>
                <ChevronDown size={12} />
                {items.length - 2} more sources available
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export function InsightsCard({ selection, answer, buckets = EMPTY_BUCKETS, activeFile, onFileSelect, files }) {
  return (
    <div className="px-3 py-2 text-slate-200">
      <div className="flex items-center gap-2 text-xs text-slate-300 mb-3">
        <Pill>Insights</Pill>
        <span className="truncate">for "{selection?.slice(0, 80)}{selection?.length > 80 ? "…" : ""}"</span>
      </div>

      {answer && (
        <div className="mt-2 p-3">
          <MarkdownText text={answer} />
        </div>
      )}

      <BucketBlock title="Overlapping" items={buckets.overlapping} activeFile={activeFile} onFileSelect={onFileSelect} files={files} />
      <BucketBlock title="Contradictory" items={buckets.contradictory} activeFile={activeFile} onFileSelect={onFileSelect} files={files} />
      <BucketBlock title="Examples" items={buckets.examples} activeFile={activeFile} onFileSelect={onFileSelect} files={files} />
      <BucketBlock title="Definitions" items={buckets.definitions} activeFile={activeFile} onFileSelect={onFileSelect} files={files} />
      <BucketBlock title="Related" items={buckets.related} activeFile={activeFile} onFileSelect={onFileSelect} files={files} />
    </div>
  );
}

// export default function ChatPanel({ activeFile, onFileSelect, files }) {
//   const [messages, setMessages] = useState([
//     { role: "assistant", content: "Hi! I'm your doc AI. Select text in the PDF to see overlapping, contradictory, examples, and more." },
//   ]);
//   const [input, setInput] = useState("");
//   const [tab, setTab] = useState("insights");
//   const [lastSelection, setLastSelection] = useState("");
//   const [podcastWorking, setPodcastWorking] = useState(false);
//   const [insightsLoading, setInsightsLoading] = useState(false);
//   const viewRef = useRef(null);

//   // viewer selections -> "doc-anchor"
//   useEffect(() => {
//     async function handleAnchor(e) {
//       const { text } = e.detail || {};
//       const sel = (text || "").trim();
//       if (!sel) return;

//       setLastSelection(sel);
//       setInsightsLoading(true);

//       setMessages((m) => [
//         ...m,
//         { role: "user", content: `🔎 Selected: "${sel.length > 200 ? sel.slice(0, 200) + "…" : sel}"` },
//       ]);

//       try {
//         const res = await ragQuery(sel, 10);
//         const buckets = bucketize(sel, res.contexts || []);
//         setMessages((m) => [
//           ...m,
//           { role: "assistant_insights", selection: sel, answer: res.answer, buckets },
//         ]);
//       } catch (err) {
//         setMessages((m) => [
//           ...m,
//           { role: "assistant", content: `Failed to fetch insights: ${String(err.message || err)}` },
//         ]);
//       } finally {
//         setInsightsLoading(false);
//       }
//     }
    
//     window.addEventListener("doc-anchor", handleAnchor);
//     return () => window.removeEventListener("doc-anchor", handleAnchor);
//   }, []);

//   // free-typed questions
//   const send = useCallback(async (text) => {
//     const t = text.trim();
//     if (!t) return;
//     setMessages((m) => [...m, { role: "user", content: t }]);
//     setInput("");
//     setInsightsLoading(true);
    
//     try {
//       const res = await ragQuery(t, 10);
//       const buckets = bucketize(t, res.contexts || []);
//       setMessages((m) => [
//         ...m,
//         { role: "assistant_insights", selection: t, answer: res.answer, buckets },
//       ]);
//     } catch (err) {
//       setMessages((m) => [
//         ...m,
//         { role: "assistant", content: `Failed to fetch: ${String(err.message || err)}` },
//       ]);
//     } finally {
//       setInsightsLoading(false);
//     }
//   }, []);

//   const visible = messages.filter((m) => {
//     if (tab === "insights") return m.role === "assistant_insights";
//     if (tab === "chat") return m.role !== "assistant_insights";
//     return false;
//   });

//   return (
//     <div className="h-full min-h-0 flex flex-col">
//       <TopTabs tab={tab} setTab={setTab} podcastWorking={podcastWorking} />

//       <div
//         ref={viewRef}
//         className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 themed-scrollbar"
//         id={`panel-${tab}`}
//         role="tabpanel"
//         aria-labelledby={`${tab}-tab`}
//       >
//         <div hidden={tab !== "podcast"}>
//           <PodcastPanel
//             activeFile={activeFile}
//             lastSelection={lastSelection}
//             onWorkingChange={setPodcastWorking}
//           />
//         </div>
       
//         <div hidden={tab !== "insights"}>
//           {insightsLoading && <InsightsLoading />}
//           {visible.length ? (
//             visible.map((m, i) => (
//               <InsightsCard
//                 key={`ins-${i}`}
//                 selection={m.selection}
//                 answer={m.answer}
//                 buckets={m.buckets}
//                 activeFile={activeFile}
//                 onFileSelect={onFileSelect}
//                 files={files}
//               />
//             ))
//           ) : (
//             !insightsLoading && (
//               <div className="text-xs text-slate-400 px-2">
//                 No insights yet. Select text in the PDF or ask a question from the Chat tab.
//               </div>
//             )
//           )}
//         </div>

//         <div hidden={tab !== "chat"}>
//           {visible.map((m, i) => (
//             <div
//               key={`chat-${i}`}
//               className={cls(
//                 "max-w-[92%] rounded-md px-3 py-2 text-sm",
//                 m.role === "assistant"
//                   ? "bg-slate-800/40 text-slate-200 border border-slate-700"
//                   : "bg-slate-800/60 text-slate-200 ml-auto"
//               )}
//             >
//               {m.content}
//             </div>
//           ))}
//         </div>
//       </div>

//       {tab === "chat" && (
//         <div className="p-3 border-t border-slate-700">
//           <div className="flex items-center gap-2">
//             <input
//               value={input}
//               onChange={(e) => setInput(e.target.value)}
//               onKeyDown={(e) => e.key === "Enter" && send(input)}
//               placeholder="Ask across your PDFs…"
//               className="flex-1 bg-slate-800/40 outline-none text-sm text-slate-200 placeholder:text-slate-400 px-3 py-2 rounded-md border border-slate-700 focus:ring-2 focus:ring-slate-500"
//             />
//             <button
//               onClick={() => send(input)}
//               className="px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-2 text-sm"
//             >
//               <Send size={16} />
//             </button>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }
