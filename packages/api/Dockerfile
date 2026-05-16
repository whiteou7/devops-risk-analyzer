FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace root manifests
COPY package.json ./
COPY tsconfig.base.json ./

# Copy package manifests (db must come before api — it's a dependency)
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/api/package.json ./packages/api/

# Install all workspace deps
RUN npm install

# Copy source
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY packages/api ./packages/api

# Build in dependency order: shared → db → api
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/db
RUN npm run build --workspace=packages/api

# ---- Runtime ----
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/api/package.json ./packages/api/

RUN npm install --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/config ./packages/shared/config
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/api/dist ./packages/api/dist

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "packages/api/dist/main.js"]
