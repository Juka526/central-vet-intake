#!/usr/bin/env bash
# One-time publication of the existing baseline plus the reviewed M0 checkout.
set -euo pipefail
cd "$(dirname "$0")/.."
repo=Juka526/central-vet-intake
url="https://github.com/$repo.git"
branch=feat/m0-development-environment
bundle=.handoff/m0.bundle
[[ "$(gh api user --jq .login)" == Juka526 ]] || { echo "Sign in to GitHub as Juka526." >&2; exit 1; }
if [[ ! -d .git ]]; then
  [[ -s "$bundle" ]] || { echo "Missing M0 handoff bundle." >&2; exit 1; }
  git init -b "$branch"
fi
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  git fetch "$bundle" refs/heads/main:refs/heads/main refs/tags/demo-baseline:refs/tags/demo-baseline "refs/heads/$branch:refs/remotes/handoff/$branch"
  git reset --mixed "refs/remotes/handoff/$branch"
fi
[[ "$(git branch --show-current)" == "$branch" ]] || { echo "Run from the M0 feature branch." >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "Review local changes before publishing." >&2; exit 1; }
[[ "$(git rev-parse main)" == "$(git rev-parse demo-baseline)" ]]
if ! result=$(gh api "repos/$repo" --jq .private 2>&1); then
  [[ "$result" == *"HTTP 404"* ]] || { echo "$result" >&2; exit 1; }
  gh repo create "$repo" --private
fi
[[ "$(gh api "repos/$repo" --jq '.private and .permissions.push')" == true ]]
if ! git remote get-url origin >/dev/null 2>&1; then git remote add origin "$url"; fi
[[ "$(git remote get-url --push origin)" == "$url" ]]
git push --atomic origin main refs/tags/demo-baseline
node scripts/github-setup.mjs
issue=$(gh api --paginate "repos/$repo/issues?state=all&per_page=100" --jq '.[] | select((.body // "") | contains("<!-- central-vet-task:foundation -->")) | .number' | head -1)
[[ "$issue" =~ ^[0-9]+$ ]]
remote_branch="feat/$issue-intake"
git push origin "HEAD:refs/heads/$remote_branch"
pr=$(gh pr list -R "$repo" --base main --head "$remote_branch" --state open --json url --jq '.[0].url // empty')
if [[ -z "$pr" ]]; then
  prior=$(gh pr list -R "$repo" --base main --head "$remote_branch" --state closed --json state,url --jq '.[0] | select(. != null) | .state+" "+.url')
  if [[ -n "$prior" ]]; then echo "$prior"; exit 1; fi
  milestone=$(gh issue view "$issue" -R "$repo" --json milestone --jq .milestone.title)
  body=$(mktemp)
  trap 'rm -f "$body"' EXIT
  cat >"$body" <<EOT
Closes #$issue

커밋 $(git rev-parse HEAD). 검증 내역은 docs/roadmap.md에서 확인합니다.
M0 개발 하네스, 검증 워크플로, 클라우드 기반 구성을 검토합니다.
실제 GCP 프로비저닝 및 저장소 왕복 검증은 후속 infra 이슈에서 추적합니다.
EOT
  pr=$(gh pr create -R "$repo" --draft --base main --head "$remote_branch" --milestone "$milestone" --title 'M0 개발 환경 구성' --body-file "$body")
fi
echo "$pr"
