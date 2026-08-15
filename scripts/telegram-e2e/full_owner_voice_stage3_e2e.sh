#!/usr/bin/env bash
set -euo pipefail
cd /opt/tg_post_agent
set -a
. .runtime/bot.env
. .runtime/telegram-e2e.env
. "$TG_POST_AGENT_REAL_TG_SESSION_ENV_FILE"
export TG_POST_AGENT_REAL_TG_API_ID="${!TG_POST_AGENT_REAL_TG_SOURCE_API_ID_VAR}"
export TG_POST_AGENT_REAL_TG_API_HASH="${!TG_POST_AGENT_REAL_TG_SOURCE_API_HASH_VAR}"
export TG_POST_AGENT_REAL_TG_STRING_SESSION="${!TG_POST_AGENT_REAL_TG_SOURCE_SESSION_VAR}"
export TG_POST_AGENT_REAL_TG_BOT_TOKEN="$BOT_TOKEN"
export TG_POST_AGENT_OWNER_AUDIO_COPY=/tmp/tg-post-agent-owner-voice-run.mp3
export TG_POST_AGENT_FULL_E2E_LEDGER_PATH=/tmp/tg-post-agent-billable-ledger-2026-08-15.json
export PROVIDER_FALLBACKS_ENABLED=false
export SOURCE_AUDIO_JOB_MAX_ATTEMPTS=1
export PLAN_SPLIT_JOB_MAX_ATTEMPTS=1
export DRAFT_GENERATION_JOB_MAX_ATTEMPTS=1
export FORMATTING_JOB_MAX_ATTEMPTS=1
case "${1:-run}" in
  preflight) exec python3 scripts/telegram-e2e/full_owner_voice_stage3_e2e.py --preflight ;;
  source-preflight) exec python3 scripts/telegram-e2e/full_owner_voice_stage3_e2e.py --source-preflight ;;
  run) exec python3 scripts/telegram-e2e/full_owner_voice_stage3_e2e.py ;;
  *) exit 64 ;;
esac
