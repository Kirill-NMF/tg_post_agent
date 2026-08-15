#!/usr/bin/env bash
set -euo pipefail

cd /opt/tg_post_agent
runtime_user=shorttalk
pid_file=.runtime/bot.pid

stop_runtime() {
  if [ -f "$pid_file" ]; then
    pid=$(tr -cd '0-9' < "$pid_file")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid"
      for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    fi
  fi
}

start_runtime() {
  overlay=$1
  su -s /bin/bash "$runtime_user" -c "cd /opt/tg_post_agent; set -a; . .runtime/bot.env; if [ '$overlay' = overlay ]; then export PROVIDER_FALLBACKS_ENABLED=false SOURCE_AUDIO_JOB_MAX_ATTEMPTS=1 PLAN_SPLIT_JOB_MAX_ATTEMPTS=1 DRAFT_GENERATION_JOB_MAX_ATTEMPTS=1 FORMATTING_JOB_MAX_ATTEMPTS=1; fi; nohup node dist/src/index.js >> .runtime/bot.log 2>&1 & echo \$! > .runtime/bot.pid"
}

restore_normal_runtime() {
  stop_runtime
  start_runtime normal
}

case "${1:-preflight}" in
  preflight)
    exec bash scripts/telegram-e2e/full_owner_voice_stage3_e2e.sh preflight
    ;;
  scope-preflight)
    exec su -s /bin/bash "$runtime_user" -c 'cd /opt/tg_post_agent; set -a; . .runtime/bot.env; TG_POST_AGENT_SCOPE_PREFLIGHT=true node scripts/telegram-e2e/project_recipient_scope.mjs'
    ;;
  run)
    trap restore_normal_runtime EXIT
    stop_runtime
    start_runtime overlay
    sleep 2
    su -s /bin/bash "$runtime_user" -c 'cd /opt/tg_post_agent; bash scripts/telegram-e2e/full_owner_voice_stage3_e2e.sh run'
    ;;
  *)
    exit 64
    ;;
esac
