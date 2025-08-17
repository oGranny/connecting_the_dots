import os
import time
import threading

try:
    from google import genai
    from google.genai import types
except Exception:
    genai = None
    types = None

def ensure_genai_client():
    if genai is None or types is None:
        raise RuntimeError("google-genai not installed. pip install google-genai")
    key = os.getenv("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError("GOOGLE_API_KEY env var not set")
    return genai.Client()

class RpsLimiter:
    def __init__(self, rps: float):
        self.min_interval = 1.0 / max(1e-6, rps)
        self._last = 0.0
        self._lock = threading.Lock()

    def wait(self):
        with self._lock:
            now = time.time()
            wait_for = self.min_interval - (now - self._last)
            if wait_for > 0:
                time.sleep(wait_for)
            self._last = time.time()

def is_retryable(err: Exception) -> bool:
    s = str(err).lower()
    keys = ["429", "rate", "quota", "resourceexhausted", "exceeded", "retry", "temporarily"]
    return any(k in s for k in keys)

def with_retry(fn, limiter: RpsLimiter, max_retries: int, base_backoff: float, max_backoff: float):
    last = None
    for attempt in range(max_retries + 1):
        try:
            if limiter:
                limiter.wait()
            return fn()
        except Exception as e:
            if not is_retryable(e) or attempt == max_retries:
                last = e
                break
            sleep_s = min(max_backoff, (base_backoff * (2 ** attempt)))
            time.sleep(sleep_s)
    raise last
