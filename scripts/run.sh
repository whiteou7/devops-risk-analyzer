#!/bin/bash

API_URL="http://localhost:3000"
REPO_URL=${1:-"https://github.com/owner/repo"}

echo "Submitting job for repo: $REPO_URL"

# Submit job
response=$(curl -s -X POST "$API_URL/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"repoUrl\": \"$REPO_URL\"}")

echo "Response: $response"

# Extract jobId (requires jq)
jobId=$(echo "$response" | jq -r '.jobId')

if [ -z "$jobId" ] || [ "$jobId" = "null" ]; then
  echo "Failed to get jobId"
  exit 1
fi

echo "Job ID: $jobId"
echo "Polling for result..."

# Poll loop
while true; do
  result=$(curl -s "$API_URL/jobs/$jobId")
  status=$(echo "$result" | jq -r '.status')

  echo "Status: $status"

  if [ "$status" = "completed" ] || [ "$status" = "failed" ]; then
    echo "Final result:"
    echo "$result" | jq
    break
  fi

  sleep 1
done