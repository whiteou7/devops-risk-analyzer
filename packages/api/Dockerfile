FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace root manifests
COPY package.json ./
COPY tsconfig.base.json ./

# Copy package manifests
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/

# Install all workspace deps
RUN npm install

# Copy source
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api

# Build shared then api
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/api

# ---- Runtime ----
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/

RUN npm install --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/api/dist ./packages/api/dist

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "packages/api/dist/main.js"]
