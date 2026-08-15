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
export TG_POST_AGENT_OWNER_AUDIO_COPY=/tmp/tg-post-agent-owner-voice-run.bin
python3 scripts/telegram-e2e/full_owner_voice_stage3_e2e.py
