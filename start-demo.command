#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null; then
  echo 'Node.js 22.13 이상을 먼저 설치해 주세요.'
  read -r '?Enter를 누르면 종료합니다. '
  exit 1
fi
node server.mjs
