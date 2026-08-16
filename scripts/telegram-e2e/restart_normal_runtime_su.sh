#!/usr/bin/env bash
set -euo pipefail

cd /opt/tg_post_agent
pid_file=.runtime/bot.pid
runtime_log=.runtime/bot-current.log

stop_exact_runtime() {
  if [[ ! -f "$pid_file" ]]; then
    return
  fi
  local pid
  pid="$(tr -cd '0-9' < "$pid_file")"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid"
    for _ in $(seq 1 30); do
      kill -0 "$pid" 2>/dev/null || return
      sleep 1
    done
    return 1
  fi
}

stop_exact_runtime
install -o shorttalk -g shorttalk -m 600 /dev/null "$runtime_log"
su -s /bin/bash shorttalk -c 'cd /opt/tg_post_agent; set -a; . .runtime/bot.env; export USER=shorttalk LOGNAME=shorttalk HOME=/home/shorttalk; nohup node dist/src/index.js >> .runtime/bot-current.log 2>&1 & echo $! > .runtime/bot.pid'

for _ in $(seq 1 20); do
  pid="$(tr -cd '0-9' < "$pid_file")"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && grep -q '"event":"worker_runtime_tick_completed"' "$runtime_log"; then
    break
  fi
  sleep 1
done

pid="$(tr -cd '0-9' < "$pid_file")"
expected_uid="$(id -u shorttalk)"
actual_uid="$(awk '/^Uid:/{print $2}' "/proc/$pid/status")"
runtime_count="$(pgrep -u shorttalk -f 'node dist/src/index.js' | wc -l)"
os_identity=false
env_identity=false
db_peer=false
worker_tick=false
worker_failure=false
health=false
[[ "$actual_uid" = "$expected_uid" ]] && os_identity=true
if tr '\0' '\n' < "/proc/$pid/environ" | grep -qx 'USER=shorttalk' &&
   tr '\0' '\n' < "/proc/$pid/environ" | grep -qx 'LOGNAME=shorttalk' &&
   tr '\0' '\n' < "/proc/$pid/environ" | grep -qx 'HOME=/home/shorttalk'; then
  env_identity=true
fi
if su -s /bin/bash shorttalk -c 'cd /opt/tg_post_agent; set -a; . .runtime/bot.env; psql "$DATABASE_URL" -Atqc "select 1"' | grep -qx 1; then
  db_peer=true
fi
grep -q '"event":"worker_runtime_tick_completed"' "$runtime_log" && worker_tick=true
grep -q '"event":"worker_runtime_tick_failed"' "$runtime_log" && worker_failure=true
if [[ "$runtime_count" = 1 && "$os_identity" = true && "$env_identity" = true && "$db_peer" = true && "$worker_tick" = true && "$worker_failure" = false ]]; then
  health=true
fi
printf '{"runtimeCount":%s,"osIdentityMatched":%s,"environmentIdentityMatched":%s,"dbPeerAuth":%s,"workerTickCompleted":%s,"workerFailureObserved":%s,"healthy":%s}\n' +  "$runtime_count" "$os_identity" "$env_identity" "$db_peer" "$worker_tick" "$worker_failure" "$health"
[[ "$health" = true ]]
