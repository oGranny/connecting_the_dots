from flask import Blueprint, request, jsonify
from flask import Blueprint, request, jsonify
from ..services.podcast_service import build_transcript, build_transcript_from_selection
from ..services.rag_service import rag  # to fetch contexts if client didn't send them
from ..config import Config

bp = Blueprint("podcast_api", __name__)

@bp.post("/api/podcast/transcript")
def podcast_transcript():
    data = request.get_json(force=True, silent=True) or {}
    topic = data.get("topic", "Reaction Kinetics")
    minutes = float(data.get("minutes", 2.5))
    voice_a = data.get("voiceA", "en-IN-NeerjaNeural")
    voice_b = data.get("voiceB", "en-IN-PrabhatNeural")
    rate = data.get("rate", "0%")     # e.g., "-5%" or "+5%"
    pitch = data.get("pitch", "0st")  # e.g., "+1st" or "-1st"

    res = build_transcript(
        topic=topic,
        minutes=minutes,
        voice_a=voice_a,
        voice_b=voice_b,
        rate=rate,
        pitch=pitch,
    )
    return jsonify(res)

# Backward-compatible: keep /api/podcast
@bp.post("/api/podcast")
def podcast_legacy():
    data = request.get_json(force=True, silent=True) or {}
    topic = data.get("topic", "Reaction Kinetics")
    minutes = float(data.get("minutes", 2.5))
    voice_a = data.get("voiceA", "en-IN-NeerjaNeural")
    voice_b = data.get("voiceB", "en-IN-PrabhatNeural")
    rate = data.get("rate", "0%")
    pitch = data.get("pitch", "0st")

    res = build_transcript(
        topic=topic,
        minutes=minutes,
        voice_a=voice_a,
        voice_b=voice_b,
        rate=rate,
        pitch=pitch,
    )
    # keep old fields + new ones
    return jsonify({
        "topic": topic,
        "length": f"{minutes:.1f} min",
        "script": "\n".join(f"{t['speaker']}: {t['text']}" for t in res["turns"]),
        "audio_url": None,
        "turns": res["turns"],
        "ssml": res["ssml"],
        "estimated_seconds": res["estimated_seconds"],
        "voices": res["voices"],
        "rate": res["rate"],
        "pitch": res["pitch"],
    })


@bp.post("/api/podcast/from-selection")
def podcast_from_selection():
    data = request.get_json(force=True, silent=True) or {}

    # ONLY the sentence is important
    selection = (data.get("selection") or "").strip()
    if not selection:
        return jsonify({"error": "Provide 'selection'"}), 400

    # If no contexts provided (or empty), fetch via RAG using ONLY the sentence
    raw_contexts = data.get("contexts", None)
    top_k = int(data.get("top_k", Config.TOP_K_DEFAULT))
    if not isinstance(raw_contexts, list) or len(raw_contexts) == 0:
        contexts = rag.topk_search(selection, top_k)
    else:
        contexts = raw_contexts

    # Optional synth params (safe defaults)
    minutes = float(data.get("minutes", 2.5))
    voice_a = data.get("voiceA", "en-IN-NeerjaNeural")
    voice_b = data.get("voiceB", "en-IN-PrabhatNeural")
    rate = data.get("rate", "0%")
    pitch = data.get("pitch", "0st")

    res = build_transcript_from_selection(
        selection=selection,
        contexts=contexts,          # may be empty; builder handles it
        minutes=minutes,
        voice_a=voice_a,
        voice_b=voice_b,
        rate=rate,
        pitch=pitch,
    )

    return jsonify({
        "selection": selection,
        "turns": res["turns"],
        "ssml": res["ssml"],                       # Azure TTS-ready
        "estimated_seconds": res["estimated_seconds"],
        "voices": res["voices"],
        "rate": res["rate"],
        "pitch": res["pitch"],
        "contexts": contexts,                      # echo for traceability
        "sources": res["sources"],                 # compact manifest
    })
