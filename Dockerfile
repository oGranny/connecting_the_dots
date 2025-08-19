# ---------- 1) Build stage ----------
FROM node:20-alpine AS builder

# Do NOT treat warnings as errors in CRA during the build
ENV CI=

WORKDIR /app

# Install deps using Docker layer cache efficiently
COPY package.json package-lock.json* ./
# allow peer-dep conflict during install (react-pdf vs @react-pdf-viewer)
RUN npm ci --no-audit --no-fund --legacy-peer-deps

# Copy the rest and build
COPY . .
# If you host under a subpath, set PUBLIC_URL before build
# ENV PUBLIC_URL=/
# Ensure CI is empty for this step even if inherited
RUN CI= npm run build

# ---------- 2) Runtime stage ----------
FROM nginx:1.27-alpine

# Nginx listens on 8080 as per jury's run command
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Ensure healthcheck tool is available
RUN apk add --no-cache wget

# Copy build output
COPY --from=builder /app/build /usr/share/nginx/html

# Entrypoint writes runtime env into /usr/share/nginx/html/env.js
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/ || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]