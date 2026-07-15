#!/usr/bin/env bash
# elizax backend proxy — 사용법: ANTHROPIC_API_KEY=sk-ant-... ./server/run.sh
cd "$(dirname "$0")"
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "[elizax] ANTHROPIC_API_KEY 미설정 — 폴백 응답 모드로 실행됩니다."
fi
exec node server.js
