# Base: JDK 21 on Ubuntu (sonar-scanner requires a JDK, not just JRE)
FROM eclipse-temurin:21-jdk-noble AS base

# Install Node.js 22, git, Python (for Checkov), and build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      git \
      ca-certificates \
      unzip \
      python3 \
      python3-pip \
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

# Install Trivy via official apt repository
RUN curl -fsSL https://aquasecurity.github.io/trivy-repo/deb/public.key \
      | gpg --dearmor -o /usr/share/keyrings/trivy.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" \
      > /etc/apt/sources.list.d/trivy.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends trivy \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Gitleaks (secret scanner)
ARG GITLEAKS_VERSION=8.18.4
RUN curl -fsSL \
      "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
      | tar -xz -C /usr/local/bin gitleaks

# Install Hadolint (Dockerfile linter)
ARG HADOLINT_VERSION=2.12.0
RUN curl -fsSL \
      "https://github.com/hadolint/hadolint/releases/download/v${HADOLINT_VERSION}/hadolint-Linux-x86_64" \
      -o /usr/local/bin/hadolint \
    && chmod +x /usr/local/bin/hadolint

# Install Checkov (IaC misconfiguration scanner)
RUN pip3 install checkov --break-system-packages --quiet

# ---- Builder stage ----
FROM base AS builder

WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./

# Copy package manifests (db must come before worker — it's a dependency)
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/worker/package.json ./packages/worker/

RUN npm install

COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY packages/worker ./packages/worker

# Build in dependency order: shared → db → worker
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/db
RUN npm run build --workspace=packages/worker

# ---- Runtime stage ----
FROM base

WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/worker/package.json ./packages/worker/

RUN npm install --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/worker/dist ./packages/worker/dist
COPY packages/shared/config ./packages/shared/config
COPY packages/worker/mock-docs ./packages/worker/mock-docs

ENV NODE_ENV=production

CMD ["node", "packages/worker/dist/main.js"]
