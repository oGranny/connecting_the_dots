from flask import Blueprint, request, jsonify
from flask import Blueprint, request, jsonify
from ..services.podcast_service import build_transcript, build_transcript_from_selection
from ..services.rag_service import rag  # to fetch contexts if client didn't send them
from ..config import Config
import os
from flask import Response
try:
    import azure.cognitiveservices.speech as speechsdk
except Exception:
    speechsdk = None

import os, requests
from flask import Response

import os, requests

def _azure_cog_tts_ssml_to_mp3(ssml: str) -> bytes:
    key = os.getenv("AZURE_SPEECH_KEY") or os.getenv("SPEECH_KEY")
    region = "centralindia"
    # region = os.getenv("") or os.getenv("SPEECH_REGION") or "centralindia"
    if not key:
        raise RuntimeError("AZURE_SPEECH_KEY missing")

    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers_base = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "User-Agent": "connecting-the-dots/1.0",
    }

    try_formats = [
        os.getenv("AZURE_TTS_FORMAT") or "audio-24khz-48kbitrate-mono-mp3",
    ]

    last = None
    for fmt in try_formats:
        h = dict(headers_base)
        h["X-Microsoft-OutputFormat"] = fmt
        try:
            r = requests.post(url, data=ssml.encode("utf-8"), headers=h, timeout=60)
            if r.ok and r.content:
                return r.content
            last = f"{r.status_code} {r.text[:300]}"
        except Exception as e:
            last = str(e)

    raise RuntimeError(f"Azure TTS failed. Tried formats {try_formats}. Last error: {last}")

def _turns_to_plain_text(turns):
    # Keep it simple: "A: ...\nB: ..." (good for single-voice TTS)
    lines = []
    for t in (turns or []):
        spk = (t.get("speaker") or "").strip() or "A"
        msg = (t.get("text") or "").strip()
        if msg:
            lines.append(f"{spk}: {msg}")
    return "\n".join(lines).strip()

def _azure_speech_config():
    if speechsdk is None:
        raise RuntimeError("azure-cognitiveservices-speech not installed. pip install azure-cognitiveservices-speech")
    key = os.getenv("AZURE_SPEECH_KEY")
    region = os.getenv("AZURE_SPEECH_REGION")
    if not key or not region:
        raise RuntimeError("Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION env vars")
    cfg = speechsdk.SpeechConfig(subscription=key, region=region)
    # 16 kHz mono mp3 is small + clear for speech
    cfg.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3
    )
    return cfg


def _speak_ssml_to_mp3_bytes(ssml: str) -> bytes:
    cfg = _azure_speech_config()
    # synth to memory (no default speakers)
    audio_cfg = speechsdk.audio.AudioOutputConfig(use_default_speaker=False)
    synth = speechsdk.SpeechSynthesizer(speech_config=cfg, audio_config=audio_cfg)
    result = synth.speak_ssml_async(ssml).get()
    if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
        details = result.cancellation_details if result.reason == speechsdk.ResultReason.Canceled else None
        raise RuntimeError(f"Azure TTS failed: reason={result.reason}; details={details}")
    return result.audio_data

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
    use_llm = bool(data.get("use_llm", True))   # <--- NEW

    res = build_transcript_from_selection(
        selection=selection,
        contexts=contexts,          # may be empty; builder handles it
        minutes=minutes,
        voice_a=voice_a,
        voice_b=voice_b,
        rate=rate,
        pitch=pitch,
        use_llm=use_llm,                         
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


@bp.post("/api/podcast/speak-ssml")   
def podcast_speak_ssml():             
    data = request.get_json(force=True, silent=True) or {}
    ssml = (data.get("ssml") or "").strip()
    if not ssml:
        return jsonify({"error": "Provide 'ssml'"}), 400
    try:
        audio = _speak_ssml_to_mp3_bytes(ssml)
        resp = Response(audio, mimetype="audio/mpeg")
        resp.headers["Content-Disposition"] = 'attachment; filename="podcast.mp3"'
        return resp
    except Exception as e:
        return jsonify({"error": "tts-failed", "detail": str(e)}), 500


# --- NEW: one-shot RAG + script + SSML + TTS -> MP3 stream ---
@bp.post("/api/podcast/from-selection/audio")
def podcast_from_selection_audio():
    data = request.get_json(force=True, silent=True) or {}

    selection = (data.get("selection") or "").strip()
    if not selection:
        return jsonify({"error": "Provide 'selection'"}), 400

    raw_contexts = data.get("contexts")
    top_k = int(data.get("top_k", Config.TOP_K_DEFAULT))
    contexts = raw_contexts if isinstance(raw_contexts, list) and raw_contexts else rag.topk_search(selection, top_k)

    minutes = float(data.get("minutes", 2.5))
    voice_a = data.get("voiceA", "en-IN-NeerjaNeural")   # not used by Azure OpenAI single-voice API
    voice_b = data.get("voiceB", "en-IN-PrabhatNeural")  # not used by Azure OpenAI single-voice API
    rate = data.get("rate", "0%")
    pitch = data.get("pitch", "0st")

    # Choose a single Azure OpenAI voice (the REST in generate_audio.py is single-voice)
    azure_voice = data.get("azureVoice") or os.getenv("AZURE_TTS_VOICE", "alloy")

    try:
        # 1) Build the script (turns)
        res = build_transcript_from_selection(
            selection=selection,
            contexts=contexts,
            minutes=minutes,
            voice_a=voice_a,
            voice_b=voice_b,
            rate=rate,
            pitch=pitch,
            use_llm=True,
        )

        # 2) Flatten to plain text for Azure OpenAI TTS
        text_for_tts = _turns_to_plain_text(res["turns"])
        if not text_for_tts:
            print("Empty script generated")
            return jsonify({"error": "empty-script"}), 500

        # 3) Generate MP3 via your Azure OpenAI wrapper
        from ..services.generate_audio import generate_audio as gen_audio_tmp
        import tempfile, io

        with tempfile.TemporaryDirectory() as tmpd:
            out_fp = os.path.join(tmpd, "podcast.mp3")
            gen_audio_tmp(text_for_tts, out_fp, provider="azure", voice=azure_voice)

            with open(out_fp, "rb") as f:
                mp3_bytes = f.read()

        resp = Response(mp3_bytes, mimetype="audio/mpeg")
        resp.headers["Content-Disposition"] = 'attachment; filename="podcast.mp3"'
        return resp

    except Exception as e:
        print("Error occurred while generating podcast:", e)
        return jsonify({"error": "pipeline-failed", "detail": str(e)}), 500

@bp.post("/api/podcast/speak")
def podcast_speak():
    """
    Prefer Azure OpenAI TTS (plain text). Accept either:
      - {"text": "...", "voice": "alloy"}
      - {"ssml": "..."}  # will be downgraded to text by stripping tags (best-effort)
    """
    data = request.get_json(force=True, silent=True) or {}
    text = (data.get("text") or "").strip()
    ssml = (data.get("ssml") or "").strip()
    azure_voice = data.get("voice") or os.getenv("AZURE_TTS_VOICE", "alloy")

    if not text and not ssml:
        return jsonify({"error": "Provide 'text' or 'ssml'"}), 400

    # If only SSML provided, do a best-effort strip to text (keeps content but loses voice/pitch)
    if not text and ssml:
        import re
        text = re.sub(r"<[^>]+>", " ", ssml)        # strip tags
        text = " ".join(text.split()).strip()

    try:
        from ..services.generate_audio import generate_audio as gen_audio_tmp
        import tempfile, io

        with tempfile.TemporaryDirectory() as tmpd:
            out_fp = os.path.join(tmpd, "podcast.mp3")
            gen_audio_tmp(text, out_fp, provider="azure", voice=azure_voice)

            with open(out_fp, "rb") as f:
                mp3_bytes = f.read()

        resp = Response(mp3_bytes, mimetype="audio/mpeg")
        resp.headers["Content-Disposition"] = 'attachment; filename="podcast.mp3"'
        return resp

    except Exception as e:
        return jsonify({"error": "tts-failed", "detail": str(e)}), 500
