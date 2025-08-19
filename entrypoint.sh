#!/usr/bin/env sh
set -eu

HTML_DIR="/usr/share/nginx/html"
ENV_JS="${HTML_DIR}/env.js"
INDEX_HTML="${HTML_DIR}/index.html"

# Write runtime env into window.__ENV (strings only)
cat > "$ENV_JS" <<'EOF'
window.__ENV = {
  ADOBE_EMBED_API_KEY: "",
  LLM_PROVIDER: "",
  GOOGLE_APPLICATION_CREDENTIALS: "",
  GEMINI_MODEL: "",
  TTS_PROVIDER: "",
  AZURE_TTS_KEY: "",
  AZURE_TTS_ENDPOINT: ""
};
EOF

# Replace a key's value in env.js, escaping chars special to sed replacement
set_val() {
  key="$1"; val="${2:-}"
  # Escape backslash and ampersand for sed replacement, then escape quotes for JS
  esc=$(printf '%s' "$val" | sed -e 's/[\\&]/\\&/g' -e 's/"/\\"/g')
  sed -i "s|\"$key\": \"[^\"]*\"|\"$key\": \"$esc\"|g" "$ENV_JS"
}

set_val ADOBE_EMBED_API_KEY "${ADOBE_EMBED_API_KEY:-}"
set_val LLM_PROVIDER "${LLM_PROVIDER:-}"
set_val GOOGLE_APPLICATION_CREDENTIALS "${GOOGLE_APPLICATION_CREDENTIALS:-}"
set_val GEMINI_MODEL "${GEMINI_MODEL:-}"
set_val TTS_PROVIDER "${TTS_PROVIDER:-}"
set_val AZURE_TTS_KEY "${AZURE_TTS_KEY:-}"
set_val AZURE_TTS_ENDPOINT "${AZURE_TTS_ENDPOINT:-}"

# Ensure env.js is referenced by index.html (insert *before* </head> if missing)
if [ -f "$INDEX_HTML" ] && ! grep -q 'src="/env.js"' "$INDEX_HTML"; then
  # BusyBox-friendly insertion (no '\n' in replacement)
  sed -i '/<\/head>/i\
  <script src="/env.js"></script>' "$INDEX_HTML"
fi

# Hand off to nginx (CMD from Dockerfile)
exec "$@"