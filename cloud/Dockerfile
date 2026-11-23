FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node server.mjs .
USER node
CMD ["node", "server.mjs"]
