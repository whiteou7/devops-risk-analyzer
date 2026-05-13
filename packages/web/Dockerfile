# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/web/package.json ./packages/web/

RUN npm install

COPY packages/shared ./packages/shared
COPY packages/web ./packages/web

RUN npm run build --workspace=packages/web

# Runtime stage — Nginx serves the static output
FROM nginx:alpine

COPY packages/web/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/packages/web/dist /usr/share/nginx/html

EXPOSE 80
