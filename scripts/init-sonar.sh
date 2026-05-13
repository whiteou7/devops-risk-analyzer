#!/usr/bin/env bash
# init-sonar.sh — run once after `docker compose up sonarqube` to:
#   1. Change the default admin password
#   2. Generate an analysis token
#   3. Print the token so you can set SONAR_TOKEN in .env
set -euo pipefail

SONAR_URL="${SONAR_URL:-http://localhost:9000}"
DEFAULT_PASSWORD="admin"

echo "SonarQube initializer"
echo "URL: $SONAR_URL"
echo ""

# ---- Prompt for new admin password ----
read -rsp "Enter new admin password (min 12 chars): " NEW_PASSWORD
echo ""

if [[ ${#NEW_PASSWORD} -lt 12 ]]; then
  echo "Error: password must be at least 12 characters" >&2
  exit 1
fi

# ---- Wait for SonarQube to be up ----
echo "Waiting for SonarQube to be ready..."
for i in {1..40}; do
  STATUS=$(curl -sf "${SONAR_URL}/api/system/status" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || true)
  if [[ "$STATUS" == "UP" ]]; then
    echo "SonarQube is ready."
    break
  fi
  sleep 5
  if [[ $i -eq 40 ]]; then
    echo "Timed out waiting for SonarQube" >&2
    exit 1
  fi
done

# ---- Change admin password ----
echo "Changing admin password..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -u "admin:${DEFAULT_PASSWORD}" \
  -X POST "${SONAR_URL}/api/users/change_password" \
  --data-urlencode "login=admin" \
  --data-urlencode "password=${NEW_PASSWORD}" \
  --data-urlencode "previousPassword=${DEFAULT_PASSWORD}")

if [[ "$HTTP_STATUS" != "204" ]]; then
  # Maybe password was already changed — try with new password
  HTTP_STATUS2=$(curl -s -o /dev/null -w "%{http_code}" \
    -u "admin:${NEW_PASSWORD}" \
    "${SONAR_URL}/api/system/status")
  if [[ "$HTTP_STATUS2" != "200" ]]; then
    echo "Error: could not change admin password (HTTP $HTTP_STATUS). Is the default password still 'admin'?" >&2
    exit 1
  fi
  echo "Password already changed or matched — continuing."
fi

# ---- Generate analysis token ----
TOKEN_NAME="devops-risk-analyzer-$(date +%Y%m%d)"
echo "Generating token '${TOKEN_NAME}'..."

RESPONSE=$(curl -sf \
  -u "admin:${NEW_PASSWORD}" \
  -X POST "${SONAR_URL}/api/user_tokens/generate" \
  --data-urlencode "name=${TOKEN_NAME}" \
  --data-urlencode "type=GLOBAL_ANALYSIS_TOKEN")

TOKEN=$(echo "$RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [[ -z "$TOKEN" ]]; then
  echo "Error: failed to parse token from response: $RESPONSE" >&2
  exit 1
fi

# ---- Done ----
echo ""
echo "=============================================="
echo "  Token generated successfully!"
echo "=============================================="
echo ""
echo "Add the following to your .env file:"
echo ""
echo "  SONAR_TOKEN=${TOKEN}"
echo "  SONAR_ADMIN_PASSWORD=${NEW_PASSWORD}"
echo ""
echo "Then start all services: docker compose up -d"
