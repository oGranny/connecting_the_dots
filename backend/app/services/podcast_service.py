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
    # input looks like "hash_Original.pdf" — keep the tail
    base = os.path.basename(pdf_name or "")
    return base.split("_", 1)[-1] if "_" in base else base or "document.pdf"

def _summarize_context_points(contexts: List[Dict[str, Any]], max_points: int = 4) -> List[str]:
    pts = []
    for c in (contexts or [])[:max_points]:
        s = _first_sentence(c.get("text", ""), 28)
        src = f"[{c.get('rank', '?')}] {_nice_pdf_name(c.get('pdf_name'))} p.{c.get('page')}"
        pts.append(f"{s} ({src}).")
    return pts

def _compose_from_selection(selection: str, context_points: List[str], target_words: int) -> List[str]:
    # Outline tailored to the selection + contexts
    # We carve ~25–40 words per line, ending near target_words.
    blocks: List[str] = []
    sel = selection.strip()
    intro = (
        f"You highlighted: “{sel}”. Let’s unpack what it means and how the documents support it."
    )
    blocks.append(intro)

    if context_points:
        blocks.append("Here is what the top sources indicate, in short beats:")
        for pt in context_points:
            blocks.append(pt)

    blocks.append("How to apply it in practice, without overthinking:")
    blocks.append("Start from the exact wording you highlighted, define the terms, then test it on a small example.")

    blocks.append("Common pitfall to avoid:")
    blocks.append("Mixing definitions with examples—keep the definition crisp and let examples illustrate, not redefine.")

    blocks.append("Quick checklist:")
    blocks.append("Definition clear? Source cited? Example concrete? Edge case noted? If yes, you’re in good shape.")

    blocks.append("Final takeaway:")
    blocks.append("Keep the claim anchored to sources; if contexts disagree, say so, then pick the scope that fits your use.")

    # Compact to target words by trimming each long line
    out: List[str] = []
    # Aim ~12–14 turns
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
    use_llm: bool = True,    # <--- NEW: toggle LLM
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

    words = sum(len(t.text.split()) for t in turns)
    est_sec = int(words / WPM * 60)
    ssml = _to_ssml(turns, voice_a, voice_b, rate, pitch)

    manifest = [
        {
            "rank": c.get("rank"),
            "pdf_name": _nice_pdf_name(c.get("pdf_name")),
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
        tag = f"[{c.get('rank','?')}] { _nice_pdf_name(c.get('pdf_name')) } p.{c.get('page')} ({c.get('start')}-{c.get('end')}):\n"
        chunk = (tag + t + "\n\n")
        if used + len(chunk) > budget_chars:
            break
        parts.append(chunk)
        used += len(chunk)
    return "".join(parts).strip()

def _llm_dialog_from_selection(selection: str, contexts: List[Dict[str, Any]], target_words: int) -> List[Turn]:
    """
    Ask the LLM to write a 2-host script that strictly uses the provided contexts.
    Output format: lines starting with `A:` or `B:`.
    """
    client = ensure_genai_client()  # requires GOOGLE_API_KEY
    ctx = _context_block_for_llm(contexts)
    sys = (
        "You are a podcast scriptwriter. Write a natural, concise two-host conversation "
        "(speakers 'A' and 'B') that strictly uses ONLY the provided PDF excerpts. "
        f"Total ~{target_words} words. Do NOT invent facts. Include an intro, key beats, and a short outro. "
        "Output ONLY lines that start with 'A:' or 'B:'; no extra commentary. "
        "Make sure to only use words that are in english, dont use words that has foreign characters like accent "
        "also dont use bullets or any other special characters."
    )
    user = (
        f"Highlighted sentence:\n{selection}\n\n"
        f"PDF EXCERPTS:\n{ctx}\n\n"
        "Write the script now."
    )
    from google.genai import types  # available because you already use google-genai
    resp = client.models.generate_content(
        model=Config.GEN_MODEL,
        contents=f"{sys}\n\n{user}",
        config=types.GenerateContentConfig(
            temperature=Config.TEMPERATURE,
            max_output_tokens=Config.MAX_OUTPUT_TOKENS_DEFAULT
        ),
    )
    text = (getattr(resp, "text", "") or "").strip()
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    turns: List[Turn] = []
    for ln in lines:
        if ln.startswith("A:"):
            turns.append(Turn("A", ln[2:].strip()))
        elif ln.startswith("B:"):
            turns.append(Turn("B", ln[2:].strip()))
    # fallback in case the model didn't follow the format
    if not turns:
        turns = _alternate_speakers(_compose_from_selection(selection, _summarize_context_points(contexts, 4), target_words))
    return turns

