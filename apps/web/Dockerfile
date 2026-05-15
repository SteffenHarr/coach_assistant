# Multi-stage build for the React/Vite frontend served as static assets by Caddy.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM caddy:2-alpine AS runtime
COPY --from=build /app/dist /srv/web
RUN printf ':80 {\n\troot * /srv/web\n\ttry_files {path} /index.html\n\tfile_server\n\tencode gzip\n}\n' > /etc/caddy/Caddyfile
EXPOSE 80
