#!/usr/bin/env bash
set -euo pipefail

cd /opt/tg_post_agent
action="${1:-}"
case "$action" in
  create|enqueue_format_option2|cleanup) ;;
  *) exit 2 ;;
esac
set -a
. .runtime/bot.env
. .runtime/d2-test-recipient.env
set +a
exec runuser -u shorttalk -- env \
  DATABASE_URL="$DATABASE_URL" \
  TG_POST_AGENT_PRODUCTION_SHAPE_ACCOUNT_ID="$TG_POST_AGENT_REAL_TG_TEST_RECIPIENT_ID" \
  node scripts/telegram-e2e/production_shape_format_fixture.mjs "$action"
