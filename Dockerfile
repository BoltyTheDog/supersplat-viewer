FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 SPLATS_DIR=/splats
COPY --from=build /app/public ./public
COPY --from=build /app/dist ./dist
COPY scripts/server.mjs ./scripts/server.mjs
COPY scripts/auth.mjs ./scripts/auth.mjs
USER node
EXPOSE 3000
CMD ["node", "scripts/server.mjs"]
