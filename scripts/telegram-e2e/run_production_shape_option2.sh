#!/usr/bin/env bash
set -euo pipefail
cd /opt/tg_post_agent
delivery_report=/tmp/tg-post-agent-e2e-reports/production-shape-option2-79b62f8.json
runner_report=/tmp/tg-post-agent-e2e-reports/production-shape-option2-runner-79b62f8.json
test ! -e "$delivery_report"
test ! -e "$runner_report"
set -a
. .runtime/bot.env
. .runtime/telegram-e2e.env
. "$TG_POST_AGENT_REAL_TG_SESSION_ENV_FILE"
. .runtime/d2-test-recipient.env
set +a
api_id="${!TG_POST_AGENT_REAL_TG_SOURCE_API_ID_VAR}"
api_hash="${!TG_POST_AGENT_REAL_TG_SOURCE_API_HASH_VAR}"
session="${!TG_POST_AGENT_REAL_TG_SOURCE_SESSION_VAR}"
exec runuser -u shorttalk -- env \
  DATABASE_URL="$DATABASE_URL" \
  BOT_TOKEN="$BOT_TOKEN" \
  OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  OPENROUTER_FORMATTING_MODEL="$OPENROUTER_FORMATTING_MODEL" \
  OPENROUTER_FORMATTING_PROVIDER_ORDER="${OPENROUTER_FORMATTING_PROVIDER_ORDER:-}" \
  PROVIDER_FALLBACKS_ENABLED=false \
  FORMATTING_JOB_MAX_ATTEMPTS=1 \
  TG_POST_AGENT_REAL_TG_API_ID="$api_id" \
  TG_POST_AGENT_REAL_TG_API_HASH="$api_hash" \
  TG_POST_AGENT_REAL_TG_STRING_SESSION="$session" \
  TG_POST_AGENT_REAL_TG_BOT_TOKEN="$BOT_TOKEN" \
  TG_POST_AGENT_REAL_TG_TEST_RECIPIENT_ID="$TG_POST_AGENT_REAL_TG_TEST_RECIPIENT_ID" \
  TG_POST_AGENT_FORMAT_FIXTURE_STATE_PATH=/tmp/tg-post-agent-production-shape-format-state.json \
  TG_POST_AGENT_SINGLE_STAGE_FORMAT_REPORT="$runner_report" \
  TG_POST_AGENT_FAILED_DECORATION_DELIVERY_REPORT="$delivery_report" \
  python3 scripts/telegram-e2e/failed_decoration_delivery.py
