#!/usr/bin/env bash
# Release script for @prysmid/mcp v0.1.0.
#
# Prereq (one-time, on Fernando's npmjs.com account):
#   1. https://www.npmjs.com  → create org `prysmid` (free for public packages)
#   2. Generate granular access token, scope @prysmid, read+write, 365d
#   3. Paste into ~/.devvault/providers/npm.yml under prysmid_publish.token
#
# After that, this script:
#   - pulls the token from devvault
#   - sets it as NPM_TOKEN secret on PrysmID/mcp-server
#   - tags v0.1.0 and pushes
#   - tail-watches the publish workflow until success

set -euo pipefail

REPO="PrysmID/mcp-server"
TAG="v0.1.0"

NPM_TOKEN=$(awk '/^[[:space:]]*prysmid_publish:/,/^[^[:space:]]/' ~/.devvault/providers/npm.yml \
    | grep -E '^[[:space:]]*token:' | head -1 | cut -d'"' -f2)

if [ -z "$NPM_TOKEN" ]; then
    echo "ERROR: ~/.devvault/providers/npm.yml has no token under prysmid_publish.token" >&2
    echo "Create one at https://www.npmjs.com/settings/<your-user>/tokens (granular, scope=@prysmid)" >&2
    exit 1
fi

echo "→ Setting NPM_TOKEN secret on $REPO"
gh secret set NPM_TOKEN --repo "$REPO" --body "$NPM_TOKEN"

echo "→ Tagging $TAG and pushing"
git tag "$TAG"
git push origin "$TAG"

echo "→ Waiting for publish workflow"
sleep 5
RUN_ID=$(gh run list --repo "$REPO" --workflow publish.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID" --repo "$REPO" --exit-status
echo "→ Published. Smoke test: claude mcp add prysmid npx -y @prysmid/mcp"
