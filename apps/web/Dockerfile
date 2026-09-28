# Multi-stage build for the React/Vite frontend served as static assets by Caddy.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM caddy:2-alpine AS runtime
# Non-root: bind an unprivileged port (8080) instead of 80, since this
# container is only ever reached internally (the outer Caddy reverse-proxies
# to it) — no need for root/CAP_NET_BIND_SERVICE at all.
RUN addgroup -S web && adduser -S web -G web
COPY --from=build /app/dist /srv/web
RUN mkdir -p /config /data \
    && printf ':8080 {\n\troot * /srv/web\n\ttry_files {path} /index.html\n\tfile_server\n\tencode gzip\n}\n' > /etc/caddy/Caddyfile \
    && chown -R web:web /srv/web /config /data /etc/caddy
USER web
EXPOSE 8080
