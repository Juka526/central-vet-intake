FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node cloud/server.mjs cloud/visits.mjs cloud/visits-store.mjs cloud/audio-store.mjs ./cloud/
COPY --chown=node:node lib/*.mjs ./lib/
USER node
CMD ["node", "cloud/server.mjs"]
