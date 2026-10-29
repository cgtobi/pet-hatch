# Home Assistant app image. Home Assistant only sees this folder when building, so the game itself is
# fetched from its Git repository and built here; the result matches the main Dockerfile.
# Home Assistant passes its own base image as BUILD_FROM, which has no Node.js, so both stages use Node's
# image directly instead. To build a fork, change PET_HATCH_REPO (and PET_HATCH_REF for a branch or tag).

FROM node:22-alpine AS build
ARG PET_HATCH_REPO=https://github.com/cgtobi/pet-hatch.git
ARG PET_HATCH_REF=main
# Home Assistant passes the app version; using it here makes every new version fetch fresh code instead of
# reusing a cached clone from an earlier build.
ARG BUILD_VERSION
RUN apk add --no-cache git
WORKDIR /app
RUN echo "Building Pet Hatch ${BUILD_VERSION}" \
 && git clone --depth 1 --branch "$PET_HATCH_REF" "$PET_HATCH_REPO" . \
 && npm ci \
 && npm run build

FROM node:22-alpine
ARG BUILD_ARCH
ARG BUILD_VERSION
LABEL io.hass.type="addon" io.hass.arch="${BUILD_ARCH}" io.hass.version="${BUILD_VERSION}"
ENV NODE_ENV=production \
    PORT=8787 \
    STATIC_DIR=/app/dist
WORKDIR /app
COPY --from=build /app/node_modules/ws ./node_modules/ws
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "server/relay.mjs"]
