# Pet Hatch: the game plus the optional live battle relay, in one small image.
#
#   docker build -t pet-hatch .
#   docker run -p 8787:8787 pet-hatch
#
# Serve it over HTTPS (reverse proxy) so the game can be installed as an app; pass WebSockets through for /relay.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8787 \
    STATIC_DIR=/app/dist
WORKDIR /app
# The relay's only runtime dependency is ws (which has none of its own); the game is static files.
COPY --from=build /app/node_modules/ws ./node_modules/ws
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "server/relay.mjs"]
