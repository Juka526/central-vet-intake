#!/bin/zsh
set -eu
gcloud auth login
if ! codex mcp get gcloud >/dev/null 2>&1; then
  codex mcp add gcloud -- npx -y @google-cloud/gcloud-mcp
fi
codex mcp get gcloud
gcloud billing accounts list --filter='open=true' --format='table(name,displayName)'
echo 'Codex에서 MCP를 새로고침하거나 새 세션을 열어 gcloud 도구를 확인하세요.'
