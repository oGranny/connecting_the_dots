import os
import dotenv

dotenv.load_dotenv()

_here = os.path.dirname(__file__)
BASE_DIR = os.path.abspath(os.path.join(_here, ".."))  # /backend

class Config:
    # Core
    PORT = int(os.getenv("PORT", "4000"))
    FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "*")
    BASE_DIR = BASE_DIR
    UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
    RAG_DIR = os.path.join(BASE_DIR, "rag_index")
    ALLOWED_MIME = {"application/pdf"}

    # YOLO
    YOLO_MODEL = os.getenv("YOLO_MODEL", os.path.join(BASE_DIR, "model", "model.pt"))

    # RAG models
    EMBED_MODEL = os.getenv("EMBED_MODEL_DEFAULT", "text-embedding-004")
    GEN_MODEL = os.getenv("GEN_MODEL_DEFAULT", "gemini-2.5-flash")

    # RAG params
    EMBED_DIM = int(os.getenv("EMBED_DIM_DEFAULT", "768"))
    CHUNK_CHARS = int(os.getenv("CHUNK_CHARS_DEFAULT", "900"))
    CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP_DEFAULT", "150"))
    TOP_K_DEFAULT = int(os.getenv("TOP_K_DEFAULT", "5"))
    TEMPERATURE = float(os.getenv("TEMPERATURE_DEFAULT", "0.2"))
    MAX_OUTPUT_TOKENS_DEFAULT = int(os.getenv("MAX_OUTPUT_TOKENS", "800"))
    CTX_BUDGET_CHARS = int(os.getenv("CTX_BUDGET_CHARS", "4000"))
    CTX_SNIPPET_CHARS = int(os.getenv("CTX_SNIPPET_CHARS", "900"))
    EMBED_BATCH = int(os.getenv("EMBED_BATCH", "100"))
    EMBED_RPS = float(os.getenv("EMBED_RPS", "0.5"))
    GEN_RPS = float(os.getenv("GEN_RPS", "0.2"))
    MAX_RETRIES = int(os.getenv("MAX_RETRIES", "8"))
    BASE_BACKOFF = float(os.getenv("BASE_BACKOFF", "1.5"))
    MAX_BACKOFF = float(os.getenv("MAX_BACKOFF", "20.0"))

    # RAG files
    VEC_PATH = os.path.join(RAG_DIR, "vectors.npy")
    META_PATH = os.path.join(RAG_DIR, "meta.jsonl")
    EMBED_CACHE_PATH = os.path.join(RAG_DIR, "embed_cache.jsonl")
    FILES_REG_PATH = os.path.join(RAG_DIR, "files_registry.json")

    # Answer quality settings
    MIN_ANSWER_LENGTH = 20  # Minimum acceptable answer length
    ANSWER_RETRY_ATTEMPTS = 3
    FALLBACK_TEMPERATURE_INCREMENT = 0.2
