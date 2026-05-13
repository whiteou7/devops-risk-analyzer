# Base: JDK 21 on Ubuntu (sonar-scanner requires a JDK, not just JRE)
FROM eclipse-temurin:21-jdk-noble AS base

# Install Node.js 22 and git
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      git \
      ca-certificates \
      unzip \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install sonar-scanner CLI
ARG SONAR_SCANNER_VERSION=6.1.0.4477
RUN curl -fsSL \
      "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-${SONAR_SCANNER_VERSION}-linux-x64.zip" \
      -o /tmp/sonar-scanner.zip \
    && unzip /tmp/sonar-scanner.zip -d /opt \
    && ln -s /opt/sonar-scanner-${SONAR_SCANNER_VERSION}-linux-x64/bin/sonar-scanner /usr/local/bin/sonar-scanner \
    && rm /tmp/sonar-scanner.zip

# ---- Builder stage ----
FROM base AS builder

WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/worker/package.json ./packages/worker/

RUN npm install

COPY packages/shared ./packages/shared
COPY packages/worker ./packages/worker

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/worker

# ---- Runtime stage ----
FROM base

WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/worker/package.json ./packages/worker/

RUN npm install --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/worker/dist ./packages/worker/dist

ENV NODE_ENV=production

CMD ["node", "packages/worker/dist/main.js"]
