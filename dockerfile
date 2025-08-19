# Base Python image
FROM python:3.11-slim AS base

ARG NODE_MAJOR=20

# Install Node.js
RUN apt-get update && apt-get install -y curl ca-certificates gnupg bash git --no-install-recommends \
 && curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
 && apt-get install -y nodejs \
 && apt-get purge -y --auto-remove curl gnupg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend requirements first (if they exist) to leverage Docker layer caching
COPY backend/requirements.txt backend/requirements.txt
RUN python -m venv backend/.venv \
 && . backend/.venv/bin/activate \
 && if [ -f backend/requirements.txt ]; then pip install --no-cache-dir -r backend/requirements.txt; fi

# Copy the rest of the source
COPY backend backend
COPY frontend frontend

# Install frontend dependencies (preferring clean reproducible install)
RUN if [ -f frontend/package-lock.json ]; then cd frontend && npm ci --omit=dev || npm ci; \
    elif [ -f frontend/package.json ]; then cd frontend && npm install; fi

# Optional build step (uncomment if you have a build script producing static assets)
# RUN cd frontend && npm run build

# Create an entrypoint script that:
# 1. Ensures venv is "activated" (really just uses its python)
# 2. Starts backend
# 3. Starts frontend (after backend launch)
# 4. Waits on both
RUN set -eux; \
  cat > entrypoint.sh <<'EOF'; \
#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] Starting backend (Python)..."
backend/.venv/bin/python backend/run.py &
BACK_PID=$!
echo "[entrypoint] Backend PID: $BACK_PID"

echo "[entrypoint] Starting frontend (npm start)..."
cd frontend
npm start &
FRONT_PID=$!
echo "[entrypoint] Frontend PID: $FRONT_PID"

finish() {
  echo "[entrypoint] Caught signal, stopping..."
  kill $BACK_PID $FRONT_PID 2>/dev/null || true
  wait $BACK_PID $FRONT_PID 2>/dev/null || true
}
trap finish INT TERM

# Wait on both; exit if either fails
set +e
wait -n $BACK_PID $FRONT_PID
CODE=$?
echo "[entrypoint] One process exited with code $CODE, shutting down..."
kill $BACK_PID $FRONT_PID 2>/dev/null || true
wait $BACK_PID $FRONT_PID 2>/dev/null || true
exit $CODE
EOF
RUN chmod +x entrypoint.sh

ENV PATH="/app/backend/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Expose typical backend/frontend ports (adjust as needed)
EXPOSE 8000 3000

ENTRYPOINT ["./entrypoint.sh"]