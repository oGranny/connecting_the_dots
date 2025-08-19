import html
from dataclasses import dataclass
from typing import List, Dict, Any, Optional, Tuple
import math
import random
from ..config import Config
from ..services.genai_service import ensure_genai_client  # <- use your existing Google GenAI client
from typing import Tuple

import os
import textwrap
from pathlib import Path

# ---------- knobs ----------
DEFAULT_MINUTES = 2.5            # target length (min)
WPM = 155                        # words per minute (neutral pacing)
MAX_TURN_SECS = 18               # keep turns short for naturalness
BREAK_MS_BETWEEN_TURNS = 300
DEFAULT_VOICE_A = "en-IN-NeerjaNeural"
DEFAULT_VOICE_B = "en-IN-PrabhatNeural"
DEFAULT_RATE = "0%"              # -10%..+20% safe for most voices
DEFAULT_PITCH = "0st"            # semitones (e.g., +2st)

@dataclass
class Turn:
    speaker: str  # "A" or "B"
    text: str

def _sanitize(t: str) -> str:
    return html.escape((t or "").strip())

def _target_words(minutes: float) -> int:
    return max(120, int(minutes * WPM))

def _chunk_points(total_words: int) -> List[int]:
    # split into 10–14 turns, each ≈ 25–45 words (<= MAX_TURN_SECS)
    turns = random.randint(10, 14)
    avg = total_words / turns
    sizes = []
    for _ in range(turns):
        sizes.append(max(18, int(random.uniform(0.7, 1.25) * avg)))
    # normalize to total_words
    scale = total_words / max(1, sum(sizes))
    sizes = [max(16, int(s * scale)) for s in sizes]
    # final tweak to match total exactly
    diff = total_words - sum(sizes)
    if diff != 0:
        sizes[-1] += diff
    return sizes

def _seed_outline(topic: str) -> List[Tuple[str, str]]:
    t = topic.strip()
    return [
        ("Intro",        f"Welcome! Today we’re unpacking {t}. Why it matters and where people stumble."),
        ("Big Idea 1",   f"First, the core idea behind {t}. What it is, in plain language."),
        ("Big Idea 2",   f"Second, a practical angle—how {t} shows up in real use."),
        ("Example",      f"A quick example so the idea of {t} sticks."),
        ("Common Pitfall", f"A common mistake when people work with {t}, and how to avoid it."),
        ("Clarify",      f"Let’s tidy up a subtle confusion people have around {t}."),
        ("Tactics",      f"Concrete steps to apply {t} the right way."),
        ("Contrast",     f"When {t} is not the right tool—and what to use instead."),
        ("Mini Recap",   f"Recap the essentials of {t} in a few beats."),
        ("Outro",        f"A short takeaway and where to go next to deepen {t}."),
    ]

def _expand_outline_to_text(outline: List[Tuple[str, str]], total_words: int) -> List[str]:
    # naive expansion: distribute words and write tight lines
    chunks = _chunk_points(total_words)
    out_lines: List[str] = []
    i = 0
    for _, seed in outline:
        want = chunks[min(i, len(chunks)-1)]
        # light variation so it doesn’t feel robotic
        parts = [
            seed,
            "Here’s the gist in simple terms.",
            "Think about the trade-offs and the why behind it.",
            "In practice, small constraints change the approach.",
            "Keep an eye on definitions so terms don’t drift.",
            "When in doubt, return to first principles.",
        ]
        # stitch short sentences until we hit the word quota
        acc: List[str] = []
        wc = 0
        for p in parts:
            words = p.split()
            if wc + len(words) > want:
                # trim to fit
                words = words[:max(5, want - wc)]
            acc.append(" ".join(words))
            wc += len(words)
            if wc >= want:
                break
        line = " ".join(acc)
        out_lines.append(line)
        i += 1
        if sum(len(l.split()) for l in out_lines) >= total_words:
            break
    return out_lines

def _alternate_speakers(lines: List[str]) -> List[Turn]:
    turns: List[Turn] = []
    who = "A"
    for ln in lines:
        text = ln.strip()
        if not text:
            continue
        turns.append(Turn(who, text))
        who = "B" if who == "A" else "A"
    return turns
def _sanitize_for_ssml(s: str) -> str:
    # strip control chars (except \t \n), collapse spaces, escape XML
    s = (s or "").replace("\u00A0", " ")  # nbsp -> space
    s = "".join(ch for ch in s if ch in ("\t", "\n") or 0x20 <= ord(ch) <= 0x10FFFF)
    s = " ".join(s.split())
    return html.escape(s)

def _to_ssml(turns: List[Turn],
             voice_a: str = DEFAULT_VOICE_A,
             voice_b: str = DEFAULT_VOICE_B,
             rate: str = DEFAULT_RATE,     # kept for API compatibility (unused)
             pitch: str = DEFAULT_PITCH):  # kept for API compatibility (unused)
    parts = ['<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-IN">']
    for i, t in enumerate(turns):
        txt = _sanitize_for_ssml(t.text) if "_sanitize_for_ssml" in globals() else _sanitize(t.text)
        if not txt:
            continue
        voice = voice_a if t.speaker == "A" else voice_b
        parts.append(f'<voice name="{voice}">')
        parts.append(txt)  # <--- no <prosody> wrapper at all
        if i < len(turns) - 1:
            parts.append(f'<break time="{int(BREAK_MS_BETWEEN_TURNS)}ms"/>')  # pause stays INSIDE <voice>
        parts.append('</voice>')
    parts.append('</speak>')
    return "".join(parts)

# Optional single-voice fallback if your region/voice combo dislikes multi-voice
def _to_ssml_single_voice(turns: List[Turn],
                          voice: str,
                          rate: str = DEFAULT_RATE,
                          pitch: str = DEFAULT_PITCH) -> str:
    # prefix with A:/B: so the dialog is clear even with one voice
    joined = " ".join(f"{t.speaker}: {_sanitize_for_ssml(t.text)}" for t in turns if (t.text or "").strip())
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-IN">'
        f'<voice name="{voice}"><prosody rate="{rate}" pitch="{pitch}">{joined}</prosody></voice>'
        '</speak>'
    )

def build_transcript(
    topic: str,
    minutes: Optional[float] = None,
    voice_a: str = DEFAULT_VOICE_A,
    voice_b: str = DEFAULT_VOICE_B,
    rate: str = DEFAULT_RATE,
    pitch: str = DEFAULT_PITCH,
    seed_outline: Optional[List[Tuple[str, str]]] = None,
) -> Dict[str, Any]:
    m = float(minutes) if minutes else DEFAULT_MINUTES
    total_words = _target_words(m)
    outline = seed_outline or _seed_outline(topic)
    lines = _expand_outline_to_text(outline, total_words)
    turns = _alternate_speakers(lines)
    # compute estimated duration
    words = sum(len(t.text.split()) for t in turns)
    est_sec = int(words / WPM * 60)
    ssml = _to_ssml(turns, voice_a, voice_b, rate, pitch)
    return {
        "topic": topic,
        "voices": {"A": voice_a, "B": voice_b},
        "rate": rate,
        "pitch": pitch,
        "estimated_seconds": est_sec,
        "turns": [{"speaker": t.speaker, "text": t.text} for t in turns],
        "ssml": ssml,
    }

def _words(s: str) -> int:
    return len((s or "").split())

def _shorten_by_words(s: str, max_w: int) -> str:
    w = (s or "").split()
    if len(w) <= max_w:
        return s.strip()
    return (" ".join(w[:max(5, max_w)]) + "…").strip()

def _first_sentence(s: str, fallback_words: int = 30) -> str:
    s = (s or "").strip().replace("\n", " ")
    for sep in [". ", "? ", "! "]:
        if sep in s:
            return s.split(sep, 1)[0].strip()
    return _shorten_by_words(s, fallback_words)

def _nice_pdf_name(pdf_name: str) -> str:
    # input looks like "hash_Original.pdf" — keep the tail and replace underscores with spaces
    base = os.path.basename(pdf_name or "")
    name = base.split("_", 1)[-1] if "_" in base else base or "document.pdf"
    # Replace underscores with spaces for better readability
    return name.replace("_", " ")

def _context_block_for_llm(contexts: List[Dict[str, Any]], budget_chars: int = 1800) -> str:
    used = 0
    parts = []
    for c in contexts:
        t = (c.get("text") or "").strip()
        # Remove file name from the tag - only keep rank and page info
        # No file names shown to LLM, so no underscore issue here
        tag = f"[Source {c.get('rank','?')}] Page {c.get('page')}:\n"
        chunk = (tag + t + "\n\n")
        if used + len(chunk) > budget_chars:
            break
        parts.append(chunk)
        used += len(chunk)
    return "".join(parts).strip()
import re

def _scrub_file_mentions(s: str) -> str:
    if not s:
        return s
    # remove explicit filenames like foo.pdf / bar.docx etc.
    s = re.sub(r'\b[\w\-.]+\.(?:pdf|docx?|pptx?|xlsx)\b', 'the reference', s, flags=re.I)
    # remove [Source 1], [Doc: …], bracketed refs
    s = re.sub(r'\[(?:source|doc|document|file)[^\]]*\]', '', s, flags=re.I)
    # soften generic mentions like "from document 3", "per file 2"
    s = re.sub(r'\b(?:document|file|source)\s*\d+\b', 'the reference', s, flags=re.I)
    # collapse leftover multiple spaces
    return " ".join(s.split())

def _summarize_context_points(contexts: List[Dict[str, Any]], max_points: int = 4) -> List[str]:
    pts = []
    for c in (contexts or [])[:max_points]:
        s = _first_sentence(c.get("text", ""), 28)
        if s:
            # DO NOT include doc names, pages, or "Source x" in the transcript
            pts.append(s)
    return pts

def _compose_from_selection(selection: str, context_points: List[str], target_words: int) -> List[str]:
    # Randomize the fallback opening as well
    import random
    
    openings = [
        f"So we came across this interesting point about {selection[:50]}...",
        f"There's something fascinating here about {selection[:50]}...", 
        f"This caught our attention - {selection[:50]}...",
        f"We were reading about {selection[:50]} and found...",
        f"Here's an intriguing perspective on {selection[:50]}...",
        f"Let's dive into this idea about {selection[:50]}...",
    ]
    
    blocks: List[str] = []
    # Use random opening instead of always "You highlighted"
    intro = random.choice(openings)
    blocks.append(intro)

    if context_points:
        transitions = [
            "Here's what the sources tell us:",
            "The documents reveal some key points:",
            "Looking at the evidence, we find:",
            "The research shows:",
            "From what we've read:",
        ]
        blocks.append(random.choice(transitions))
        for pt in context_points:
            blocks.append(pt)

    blocks.append("How to apply it in practice, without overthinking:")
    blocks.append("Start from the exact wording, define the terms, then test it on a small example.")

    blocks.append("Common pitfall to avoid:")
    blocks.append("Mixing definitions with examples—keep the definition crisp and let examples illustrate, not redefine.")

    blocks.append("Quick checklist:")
    blocks.append("Definition clear? Source cited? Example concrete? Edge case noted? If yes, you're in good shape.")

    endings = [
        "The key takeaway here:",
        "What this really means:",
        "Bottom line:",
        "To wrap this up:",
        "The main insight:",
    ]
    blocks.append(random.choice(endings))
    blocks.append("Keep the claim anchored to sources; if contexts disagree, say so, then pick the scope that fits your use.")

    # Compact to target words by trimming each long line
    out: List[str] = []
    want_turns = max(10, min(14, len(blocks)))
    per = max(18, int(target_words / want_turns))
    for b in blocks:
        out.append(_shorten_by_words(b, per + 10))
        if sum(_words(x) for x in out) >= target_words:
            break
    return out

def build_transcript_from_selection(
    selection: str,
    contexts: List[Dict[str, Any]],
    minutes: Optional[float] = None,
    voice_a: str = DEFAULT_VOICE_A,
    voice_b: str = DEFAULT_VOICE_B,
    rate: str = DEFAULT_RATE,
    pitch: str = DEFAULT_PITCH,
    use_llm: bool = True,
) -> Dict[str, Any]:
    m = float(minutes) if minutes else DEFAULT_MINUTES
    total_words = _target_words(m)

    if use_llm and contexts:
        turns = _llm_dialog_from_selection(selection, contexts, total_words)
    else:
        # existing rule-based composition
        points = _summarize_context_points(contexts, max_points=4)
        lines = _compose_from_selection(selection, points, total_words)
        turns = _alternate_speakers(lines)
    turns = [Turn(t.speaker, _scrub_file_mentions(t.text)) for t in turns]

    words = sum(len(t.text.split()) for t in turns)
    est_sec = int(words / WPM * 60)
    ssml = _to_ssml(turns, voice_a, voice_b, rate, pitch)

    # Use the updated _nice_pdf_name function in the manifest
    manifest = [
        {
            "rank": c.get("rank"),
            "pdf_name": _nice_pdf_name(c.get("pdf_name")),  # This now replaces underscores with spaces
            "page": c.get("page"),
            "start": c.get("start"),
            "end": c.get("end"),
        }
        for c in (contexts or [])
    ]

    return {
        "selection": selection,
        "turns": [{"speaker": t.speaker, "text": t.text} for t in turns],
        "estimated_seconds": est_sec,
        "ssml": ssml,
        "voices": {"A": voice_a, "B": voice_b},
        "rate": rate,
        "pitch": pitch,
        "sources": manifest,
    }


def _context_block_for_llm(contexts: List[Dict[str, Any]], budget_chars: int = 1800) -> str:
    used = 0
    parts = []
    for c in contexts:
        t = (c.get("text") or "").strip()
        # Remove file name from the tag - only keep rank and page info
        # No file names shown to LLM, so no underscore issue here
        tag = f"[Source {c.get('rank','?')}] Page {c.get('page')}:\n"
        chunk = (tag + t + "\n\n")
        if used + len(chunk) > budget_chars:
            break
        parts.append(chunk)
        used += len(chunk)
    return "".join(parts).strip()

def _llm_dialog_from_selection(selection: str, contexts: List[Dict[str, Any]], target_words: int) -> List[Turn]:
    """
    Two-step pipeline:
    1) Extract compact 'beats' (claims, counterpoints, examples, tips, pitfalls, takeaway) strictly from context.
    2) Render an A/B conversation from those beats with short, natural turns.
    """
    client = ensure_genai_client()
    from google.genai import types
    ctx = _context_block_for_llm(contexts, budget_chars=1400)  # tighter, higher signal

    # ---- STEP 1: extract beats as JSON ----
    sys1 = (
        "You are a careful analyst. From the provided context, extract only what is present. "
        "Return STRICT JSON with keys: hook, claims, counterpoints, examples, tips, pitfalls, takeaway. "
        "Format:\n"
        "{\n"
        '  "hook": "one-sentence hook",\n'
        '  "claims": ["...", "..."],\n'
        '  "counterpoints": ["...", "..."],\n'
        '  "examples": ["...", "..."],\n'
        '  "tips": ["...", "..."],\n'
        '  "pitfalls": ["...", "..."],\n'
        '  "takeaway": "one-sentence conclusion"\n'
        "}\n"
        "If something is not in the context, omit it rather than inventing it."
    )
    
    user1 = (
        f"TOPIC: {selection}\n\n"
        "CONTEXT (do not quote sources; never mention file names/pages/ids):\n"
        f"{ctx}\n\n"
        "Extract the beats as STRICT JSON only. No prose outside JSON."
    )
    resp1 = client.models.generate_content(
        model=Config.GEN_MODEL,
        contents=f"{sys1}\n\n{user1}",
        config=types.GenerateContentConfig(
            temperature=0.35,          # quality > variety
            top_p=0.8,
            max_output_tokens=min(800, Config.MAX_OUTPUT_TOKENS_DEFAULT),
        ),
    )
    raw = (getattr(resp1, "text", "") or "").strip()

    import json, re
    def _json_from_text(t: str) -> dict:
        # robustly parse JSON from plain text or ```json blocks
        m = re.search(r"\{.*\}", t, re.S)
        if not m:
            return {}
        try:
            return json.loads(m.group(0))
        except Exception:
            return {}

    beats = _json_from_text(raw) or {}
    hook         = beats.get("hook") or ""
    claims       = [s for s in (beats.get("claims") or []) if s.strip()]
    counter      = [s for s in (beats.get("counterpoints") or []) if s.strip()]
    examples     = [s for s in (beats.get("examples") or []) if s.strip()]
    tips         = [s for s in (beats.get("tips") or []) if s.strip()]
    pitfalls     = [s for s in (beats.get("pitfalls") or []) if s.strip()]
    takeaway     = beats.get("takeaway") or ""

    # fallback if step 1 failed
    if not (hook or claims or examples or takeaway):
        points = _summarize_context_points(contexts, max_points=4)
        lines = _compose_from_selection(selection, points, target_words)
        return _alternate_speakers(lines)

    # ---- STEP 2: render script from beats ----
    # hard limits for turn sizes to keep it snappy
    want_turns = max(10, min(14, target_words // 22))
    max_words_per_turn = 36

    sys2 = (
        "Write a natural two-host conversation (A and B) in Indian English/neutral English. "
        "Use only the provided BEATS; do not add facts. "
        "NEVER mention or allude to files, documents, pages, PDFs, sources, citations, or numbers like 'Source 2'. "
        "If such tokens appear in input, IGNORE them. "
        "Keep turns short (~18–36 words). Vary rhythm a bit. Include a little tension, resolve it, and end with a crisp takeaway."
    )
    # Build a compact beat sheet for the model
    def _join(label, items):
        return f"{label}:\n" + ("\n".join(f"- {i}" for i in items) if items else "-")

    beats_sheet = "\n\n".join(filter(None, [
        f"Hook: {hook}" if hook else "",
        _join("Claims", claims),
        _join("Counterpoints", counter),
        _join("Examples", examples),
        _join("Tips", tips),
        _join("Pitfalls", pitfalls),
        f"Takeaway: {takeaway}" if takeaway else "",
    ]))

    user2 = (
        f"TOPIC: {selection}\n\n"
        f"BEATS (only use these):\n{beats_sheet}\n\n"
        f"Target total words: ~{target_words}. "
        f"Write exactly {want_turns} lines, each starting with 'A:' or 'B:'."
    )

    resp2 = client.models.generate_content(
        model=Config.GEN_MODEL,
        contents=f"{sys2}\n\n{user2}",
        config=types.GenerateContentConfig(
            temperature=0.45,          # lower = crisper structure
            top_p=0.8,
            max_output_tokens=min(1200, Config.MAX_OUTPUT_TOKENS_DEFAULT),
        ),
    )
    text = (getattr(resp2, "text", "") or "").strip()

    # parse to turns and enforce word caps
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    turns: List[Turn] = []
    who = "A"
    for ln in lines:
        if ln.startswith("A:"):
            msg = ln[2:].strip()
            who = "B"
        elif ln.startswith("B:"):
            msg = ln[2:].strip()
            who = "A"
        else:
            # recover: alternate speakers if tag is missing
            msg = ln
            who = "B" if who == "A" else "A"
        # cap overly long lines
        words = msg.split()
        if len(words) > max_words_per_turn:
            msg = " ".join(words[:max_words_per_turn]) + "…"
        turns.append(Turn("A" if who == "B" else "B", msg))

    # strict fallback if model returned junk
    if not turns:
        points = _summarize_context_points(contexts, max_points=4)
        lines = _compose_from_selection(selection, points, target_words)
        return _alternate_speakers(lines)
    turns = [Turn(t.speaker, _scrub_file_mentions(t.text)) for t in turns]

    return turns

