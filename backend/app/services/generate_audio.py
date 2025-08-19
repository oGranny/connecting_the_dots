# backend/app/services/generate_audio.py
import os
import re
from pathlib import Path
import requests

def _chunk_text_by_chars(text: str, max_chars: int):
    """Split text into <= max_chars chunks, preferring whitespace."""
    if len(text) <= max_chars:
        return [text]
    tokens = re.findall(r"\S+\s*", text)
    chunks, cur = [], ""
    for tok in tokens:
        if len(cur) + len(tok) <= max_chars:
            cur += tok
        else:
            if cur.strip():
                chunks.append(cur.strip())
            cur = tok
    if cur.strip():
        chunks.append(cur.strip())
    return chunks

def _azure_openai_tts(text: str, voice: str) -> bytes:
    """
    Calls Azure OpenAI TTS:
      POST {AZURE_TTS_ENDPOINT}/openai/deployments/{AZURE_TTS_DEPLOYMENT}/audio/speech?api-version={AZURE_TTS_API_VERSION}
      headers: {"api-key": AZURE_TTS_KEY, "Content-Type": "application/json"}
      body: {"model": <deployment>, "input": <text>, "voice": <voice>}
    """
    api_key = os.getenv("AZURE_TTS_KEY")
    endpoint = os.getenv("AZURE_TTS_ENDPOINT")
    deployment = os.getenv("AZURE_TTS_DEPLOYMENT", "tts")
    api_version = os.getenv("AZURE_TTS_API_VERSION", "2025-03-01-preview")
    voice = voice or os.getenv("AZURE_TTS_VOICE", "alloy")

    if not api_key or not endpoint:
        raise RuntimeError("AZURE_TTS_KEY and AZURE_TTS_ENDPOINT must be set")

    url = f"{endpoint.rstrip('/')}/openai/deployments/{deployment}/audio/speech"
    params = {"api-version": api_version}
    headers = {"api-key": api_key, "Content-Type": "application/json"}
    payload = {"model": deployment, "input": text, "voice": voice}

    resp = requests.post(url, headers=headers, params=params, json=payload, timeout=60)
    resp.raise_for_status()
    return resp.content  # MP3 bytes

def generate_audio(text: str, output_file: str, provider: str = None, voice: str = None) -> str:
    """
    Generate audio file from text.
    - provider: only "azure" is implemented (others can be added later).
    - voice: Azure OpenAI voice (e.g., alloy, echo, shimmer, nova, onyx).
    Returns output_file path.
    """
    if not text or not text.strip():
        raise ValueError("Text cannot be empty")

    provider = (provider or os.getenv("TTS_PROVIDER", "azure")).lower()
    if provider != "azure":
        raise ValueError(f"Unsupported TTS_PROVIDER: {provider}. Use 'azure'.")

    out = Path(output_file)
    out.parent.mkdir(parents=True, exist_ok=True)

    # Optional chunking (no pydub/ffmpeg needed; we just append MP3 byte streams)
    max_chars_env = os.getenv("TTS_CLOUD_MAX_CHARS", "")
    try:
        max_chars = int(max_chars_env) if max_chars_env else 0
    except ValueError:
        max_chars = 0

    chunks = _chunk_text_by_chars(text, max_chars) if (max_chars and max_chars > 0 and len(text) > max_chars) else [text]

    with open(out, "wb") as f:
        for c in chunks:
            mp3 = _azure_openai_tts(c, voice=voice)
            # naive concatenation of MP3 streams generally works for sequential playback
            f.write(mp3)

    return str(out)
