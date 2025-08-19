# ---------- base ---------- 
FROM python:3.11-slim

ARG NODE_MAJOR=20

# System deps (Node + libs needed by cv2/PyMuPDF)
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg bash git \
      libgl1 libglib2.0-0 libjpeg62-turbo zlib1g \
 && curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && apt-get purge -y --auto-remove curl gnupg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---------- backend deps (venv) ----------
COPY backend/requirements.txt backend/requirements.txt
RUN python -m venv backend/.venv \
 && backend/.venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
 && backend/.venv/bin/pip install --no-cache-dir -r backend/requirements.txt

# ---------- frontend deps (cache layer) ----------
COPY package*.json ./
RUN npm config set fund false \
 && npm config set audit false \
 && ( [ -f package-lock.json ] && npm ci || npm install )

# ---------- copy source ----------
COPY . .

# Ensure uploads dir exists
RUN mkdir -p backend/uploads

# ---------- entrypoint (runs backend + frontend) ----------
# Use printf to avoid heredocs (safe on Windows line endings)
RUN printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  '' \
  'export HOST=0.0.0.0' \
  'export PORT="${PORT:-8080}"' \
  'export BROWSER=none' \
  'export CHOKIDAR_USEPOLLING=${CHOKIDAR_USEPOLLING:-true}' \
  '' \
  'export BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"' \
  'export BACKEND_PORT="${BACKEND_PORT:-4000}"' \
  '' \
  'echo "[entrypoint] Starting backend (Python) on :$BACKEND_PORT..."' \
  'backend/.venv/bin/python backend/run.py & ' \
  'BACK_PID=$!' \
  'echo "[entrypoint] Backend PID: $BACK_PID"' \
  '' \
  'echo "[entrypoint] Starting frontend (npm start) on :$PORT..."' \
  'npm start & ' \
  'FRONT_PID=$!' \
  'echo "[entrypoint] Frontend PID: $FRONT_PID"' \
  '' \
  'finish() {' \
  '  echo "[entrypoint] Caught signal, stopping..."' \
  '  kill $BACK_PID $FRONT_PID 2>/dev/null || true' \
  '  wait $BACK_PID $FRONT_PID 2>/dev/null || true' \
  '}' \
  'trap finish INT TERM' \
  '' \
  'set +e' \
  'wait -n $BACK_PID $FRONT_PID' \
  'CODE=$?' \
  'echo "[entrypoint] One process exited with code $CODE, shutting down..."' \
  'kill $BACK_PID $FRONT_PID 2>/dev/null || true' \
  'wait $BACK_PID $FRONT_PID 2>/dev/null || true' \
  'exit $CODE' \
  > /entrypoint.sh \
 && chmod +x /entrypoint.sh

# Put venv first in PATH
ENV PATH="/app/backend/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOST=0.0.0.0 \
    PORT=8080

# Expose frontend (8080) and backend (4000)
EXPOSE 8080 4000

ENTRYPOINT ["/entrypoint.sh"]
