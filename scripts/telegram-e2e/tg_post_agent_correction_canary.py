#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Mapping, TypeVar

sys.path.insert(0, str(Path(__file__).parent))

from tg_post_agent_audio_canary import convert_voice, generate_tts, validate_audio
from tg_post_agent_smoke import (
    BotIdentityError,
    CanonicalTargetMismatchError,
    UnauthorizedSessionError,
    fetch_runtime_bot_identity,
    target_matches_canonical_identity,
)

REPORT_PATH = Path("/tmp/tg-post-agent-correction-canary-report.json")
CHECKPOINT_PATH = Path("/tmp/tg-post-agent-correction-canary-checkpoint.json")
LIFECYCLE_PATH = Path("/tmp/tg-post-agent-correction-canary-lifecycle.json")
LEDGER_PATH = Path("/tmp/tg-post-agent-billable-ledger-2026-08-14.json")
FIXTURE_STATE_PATH = Path("/tmp/tg-post-agent-correction-canary-state.json")
FIXTURE_SCRIPT = Path(__file__).with_name("correction_fixture.mjs")
TEST_CHAT_CONFIRMATION = "DEDICATED_TEST_CHAT"
FIXTURE_CONFIRMATION = "CREATE_AND_DELETE_DEDICATED_SYNTHETIC_FIXTURE_ONLY"
PLAN_MARKER = "Рекомендую:"
SAFE_ERROR_MARKER = "Не удалось"
TEXT_ACK_MARKER = "Принял правку"
VOICE_ACK_MARKER = "Голосовая правка принята"
TEXT_EDIT = "Уточните план как один короткий пост."
VOICE_EDIT = "Оставьте один пост и сделайте план короче."
T = TypeVar("T")


class CanaryError(RuntimeError):
    def __init__(self, category: str):
        self.category = category
        super().__init__(category)


@dataclass(frozen=True)
class Config:
    api_id: int
    api_hash: str = field(repr=False)
    string_session: str = field(repr=False)
    bot_token: str = field(repr=False)
    database_url: str = field(repr=False)
    target_chat_id: int
    timeout_seconds: float
    duplicate_wait_seconds: float
    max_audio_seconds: float
    max_audio_bytes: int
    mode: str


def parse_config(env: Mapping[str, str]) -> Config:
    if env.get("TG_POST_AGENT_CORRECTION_CANARY_ENABLED", "").lower() != "true":
        raise CanaryError("configuration")
    if required(env, "TG_POST_AGENT_REAL_TG_TEST_TARGET_CONFIRMATION") != TEST_CHAT_CONFIRMATION:
        raise CanaryError("configuration")
    if required(env, "TG_POST_AGENT_CORRECTION_CANARY_FIXTURE_CONFIRMATION") != FIXTURE_CONFIRMATION:
        raise CanaryError("configuration")
    database_url = required(env, "DATABASE_URL")
    if "tg_post_agent" not in database_url or "tg_post_agent_test" in database_url:
        raise CanaryError("configuration")
    mode = env.get("TG_POST_AGENT_CORRECTION_CANARY_MODE", "both").strip()
    if mode not in {"both", "voice_only"}:
        raise CanaryError("configuration")
    return Config(
        api_id=positive_int(env, "TG_POST_AGENT_REAL_TG_API_ID"),
        api_hash=required(env, "TG_POST_AGENT_REAL_TG_API_HASH"),
        string_session=required(env, "TG_POST_AGENT_REAL_TG_STRING_SESSION"),
        bot_token=required(env, "TG_POST_AGENT_REAL_TG_BOT_TOKEN"),
        database_url=database_url,
        target_chat_id=positive_int(env, "TG_POST_AGENT_REAL_TG_TEST_TARGET_CHAT_ID"),
        timeout_seconds=bounded_float(env, "TG_POST_AGENT_CORRECTION_CANARY_TIMEOUT_SECONDS", 20, 180),
        duplicate_wait_seconds=bounded_float(env, "TG_POST_AGENT_REAL_TG_DUPLICATE_WAIT_SECONDS", 1, 30),
        max_audio_seconds=bounded_float(env, "TG_POST_AGENT_CORRECTION_CANARY_MAX_SECONDS", 1, 8),
        max_audio_bytes=bounded_int(env, "TG_POST_AGENT_CORRECTION_CANARY_MAX_BYTES", 1, 512 * 1024),
        mode=mode,
    )


async def run(config: Config) -> dict[str, object]:
    started = time.monotonic()
    observations: dict[str, object] = {
        "textAcknowledged": False,
        "textTerminal": "not_run",
        "textNoDuplicate": False,
        "voiceAcknowledged": False,
        "voiceTerminal": "not_started",
        "voiceNoDuplicate": False,
        "fixtureCleaned": False,
        "localAudioCleaned": False,
        "ttsDone": False,
        "ffmpegDone": False,
        "telegramUploadAttempted": False,
        "editAcknowledgementObserved": False,
        "editTranscriptionTerminal": "not_observed",
        "revisionHandoff": "not_observed",
        "revisionTerminal": "not_observed",
        "notificationObservation": "not_observed",
        "lastStage": "not_started",
    }
    client = None
    account_id: int | None = None
    status = "failed"
    failure: str | None = "runtime"
    try:
        ensure_budget(4 if config.mode == "both" else 3)
        identity, client, account_id, target = await telethon_preflight(config)
        await asyncio.to_thread(run_fixture, "create", config, account_id)
        if config.mode == "both":
            observations["textAcknowledged"], observations["textTerminal"], observations["textNoDuplicate"] = await run_text_correction(client, target, identity.telegram_id, config, started)
        observations["voiceAcknowledged"], observations["voiceTerminal"], observations["voiceNoDuplicate"] = await run_voice_correction(client, target, identity.telegram_id, config, started, observations)
        status = "passed"
        failure = None
    except BaseException as error:
        failure = category(error)
    finally:
        if account_id is not None:
            try:
                await asyncio.to_thread(run_fixture, "cleanup", config, account_id)
                observations["fixtureCleaned"] = True
            except BaseException:
                observations["fixtureCleaned"] = False
        if client:
            await client.disconnect()
        write_checkpoint(observations)
    return report(status, failure, started, observations)


async def telethon_preflight(config: Config):
    try:
        identity = await asyncio.to_thread(fetch_runtime_bot_identity, config.bot_token)
        from telethon import TelegramClient
        from telethon.sessions import StringSession

        client = TelegramClient(StringSession(config.string_session), config.api_id, config.api_hash, flood_sleep_threshold=0)
        await client.connect()
        if not await client.is_user_authorized():
            raise UnauthorizedSessionError("unauthorized session")
        account_id = (await client.get_me()).id
        target = await client.get_entity(identity.username)
        if not getattr(target, "bot", False) or not target_matches_canonical_identity(target.id, identity) or not target_matches_canonical_identity(config.target_chat_id, identity):
            raise CanonicalTargetMismatchError()
        return identity, client, account_id, target
    except (BotIdentityError, CanonicalTargetMismatchError, UnauthorizedSessionError):
        raise
    except BaseException as exc:
        raise CanaryError("telethon_preflight") from exc


async def run_text_correction(client, target, bot_id: int, config: Config, started: float) -> tuple[bool, str, bool]:
    async with client.conversation(target, timeout=config.timeout_seconds, exclusive=True) as conversation:
        record_transport("telegram_text", started)
        try:
            await conversation.send_message(TEXT_EDIT)
        except BaseException as exc:
            raise CanaryError("telegram_upload") from exc
        acknowledgement = await receive(conversation, bot_id, config.timeout_seconds, "revision_wait")
        if TEXT_ACK_MARKER not in (acknowledgement.raw_text or ""):
            raise CanaryError("revision_wait")
        reserve_billable("llm_plan_revision_text", "openrouter", started)
        terminal = await terminal_response(conversation, bot_id, config.timeout_seconds, "revision_wait")
        await assert_no_duplicate(conversation, config.duplicate_wait_seconds)
        return True, terminal, True


async def run_voice_correction(client, target, bot_id: int, config: Config, started: float, observations: dict[str, object]) -> tuple[bool, str, bool]:
    try:
        with tempfile.TemporaryDirectory(prefix="tg-post-agent-correction-canary-") as directory:
            workspace = Path(directory)
            mp3 = workspace / "synthetic-edit.mp3"
            ogg = workspace / "synthetic-edit.ogg"
            observations["lastStage"] = "tts_generation"
            reserve_billable("external_tts", "google_translate", started)
            await asyncio.to_thread(run_local_stage, "tts_generation", generate_tts, mp3)
            observations["ttsDone"] = True
            write_checkpoint(observations)
            observations["lastStage"] = "ffmpeg_conversion"
            await asyncio.to_thread(run_local_stage, "ffmpeg_conversion", convert_voice, mp3, ogg, config.max_audio_seconds)
            await asyncio.to_thread(run_local_stage, "ffmpeg_conversion", validate_audio, ogg, config)
            observations["ffmpegDone"] = True
            write_checkpoint(observations)

            async with client.conversation(target, timeout=config.timeout_seconds, exclusive=True) as conversation:
                observations["lastStage"] = "telegram_upload"
                record_transport("telegram_upload", started)
                try:
                    sent_voice = await client.send_file(target, ogg, voice_note=True)
                except BaseException as exc:
                    raise CanaryError("telegram_upload") from exc
                sent_message_id = getattr(sent_voice, "id", None)
                if not isinstance(sent_message_id, int) or sent_message_id < 1:
                    raise CanaryError("harness_runtime")
                observations["telegramUploadAttempted"] = True
                write_checkpoint(observations)
                reserve_billable("stt_edit_transcription", "openrouter", started)
                observations["lastStage"] = "ack_timeout"
                acknowledgement = await acknowledgement_after_upload(
                    conversation,
                    client,
                    target,
                    bot_id,
                    sent_message_id,
                    config.timeout_seconds,
                )
                if VOICE_ACK_MARKER not in (acknowledgement.raw_text or ""):
                    raise CanaryError("ack_timeout")
                observations["voiceAcknowledged"] = True
                observations["editAcknowledgementObserved"] = True
                write_checkpoint(observations)
                terminal = await await_voice_terminal(
                    conversation,
                    client,
                    target,
                    bot_id,
                    sent_message_id,
                    config,
                    started,
                    observations,
                )
                observations["notificationObservation"] = "terminal"
                write_checkpoint(observations)
                await assert_no_duplicate(conversation, config.duplicate_wait_seconds)
                observations["voiceNoDuplicate"] = True
                return True, terminal, True
    finally:
        observations["localAudioCleaned"] = True
        write_checkpoint(observations)


async def acknowledgement_after_upload(conversation, client, target, bot_id: int, sent_message_id: int, timeout: float):
    try:
        message = await receive(conversation, bot_id, min(5, timeout), "ack_timeout")
        if VOICE_ACK_MARKER in (message.raw_text or ""):
            return message
    except CanaryError:
        pass
    message = await wait_for_history_marker(client, target, bot_id, sent_message_id, (VOICE_ACK_MARKER,), timeout)
    if message is None:
        raise CanaryError("ack_timeout")
    return message


async def await_voice_terminal(conversation, client, target, bot_id: int, sent_message_id: int, config: Config, started: float, observations: dict[str, object]) -> str:
    deadline = asyncio.get_running_loop().time() + config.timeout_seconds
    handoff_deadline: float | None = None
    revision_billed = False
    while True:
        statuses = revision_job_status(config)
        write_lifecycle(statuses, observations)
        edit_status = statuses["edit"]
        revision_status = statuses["revision"]
        if edit_status in {"succeeded", "failed", "cancelled"}:
            observations["editTranscriptionTerminal"] = edit_status
            write_checkpoint(observations)
        if edit_status in {"failed", "cancelled"}:
            raise CanaryError("edit_transcription_terminal_failure")
        if edit_status == "succeeded" and handoff_deadline is None:
            handoff_deadline = asyncio.get_running_loop().time() + min(5, config.timeout_seconds)
        if revision_status != "missing":
            observations["revisionHandoff"] = "present"
            observations["revisionTerminal"] = revision_status if revision_status in {"succeeded", "failed", "cancelled"} else "not_observed"
            write_checkpoint(observations)
            if statuses["revisionStarted"] and not revision_billed:
                reserve_billable("llm_plan_revision_voice", "openrouter", started)
                revision_billed = True
            if revision_status in {"failed", "cancelled"}:
                raise CanaryError("revision_terminal_failure")
        elif handoff_deadline is not None and asyncio.get_running_loop().time() >= handoff_deadline:
            observations["revisionHandoff"] = "missing"
            write_checkpoint(observations)
            raise CanaryError("revision_handoff_missing")

        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            if edit_status not in {"succeeded", "failed", "cancelled"}:
                raise CanaryError("edit_transcription_timeout")
            if revision_status == "missing":
                raise CanaryError("revision_handoff_missing")
            if revision_status not in {"succeeded", "failed", "cancelled"}:
                raise CanaryError("revision_timeout")
            raise CanaryError("notification_timeout")
        message = None
        try:
            message = await asyncio.wait_for(conversation.get_response(), timeout=min(0.25, remaining))
        except TimeoutError:
            message = await history_message(client, target, bot_id, sent_message_id, (PLAN_MARKER, SAFE_ERROR_MARKER))
        except BaseException:
            message = await history_message(client, target, bot_id, sent_message_id, (PLAN_MARKER, SAFE_ERROR_MARKER))
        if message is None:
            continue
        if message.sender_id != bot_id:
            raise CanaryError("harness_runtime")
        text = message.raw_text or ""
        if PLAN_MARKER in text:
            if not revision_billed:
                reserve_billable("llm_plan_revision_voice", "openrouter", started)
            return "plan_response"
        if SAFE_ERROR_MARKER in text:
            return "safe_recovery"


async def wait_for_history_marker(client, target, bot_id: int, sent_message_id: int, markers: tuple[str, ...], timeout: float):
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        message = await history_message(client, target, bot_id, sent_message_id, markers)
        if message is not None:
            return message
        await asyncio.sleep(0.25)
    return None


async def history_message(client, target, bot_id: int, sent_message_id: int, markers: tuple[str, ...]):
    try:
        async for message in client.iter_messages(target, min_id=sent_message_id, limit=20):
            if message.sender_id == bot_id and any(marker in (message.raw_text or "") for marker in markers):
                return message
    except BaseException:
        return None
    return None


async def receive(conversation, bot_id: int, timeout: float, failure_category: str):
    try:
        message = await asyncio.wait_for(conversation.get_response(), timeout=timeout)
    except BaseException as exc:
        raise CanaryError(failure_category) from exc
    if message.sender_id != bot_id:
        raise CanaryError(failure_category)
    return message


async def terminal_response(conversation, bot_id: int, timeout: float, failure_category: str) -> str:
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise CanaryError(failure_category)
        text = (await receive(conversation, bot_id, remaining, failure_category)).raw_text or ""
        if PLAN_MARKER in text:
            return "plan_response"
        if SAFE_ERROR_MARKER in text:
            return "safe_recovery"


async def assert_no_duplicate(conversation, timeout: float) -> None:
    try:
        await asyncio.wait_for(conversation.get_response(), timeout=timeout)
    except TimeoutError:
        return
    raise CanaryError("duplicate_terminal_response")


def revision_job_status(config: Config) -> dict[str, object]:
    try:
        state = json.loads(FIXTURE_STATE_PATH.read_text(encoding="utf-8"))
        project_id = state.get("projectId")
        if not isinstance(project_id, str) or not re.fullmatch(r"[0-9a-f-]{36}", project_id) or state.get("marker") != "tier2-correction-canary-v1":
            raise ValueError
        query = "select coalesce((select status::text from jobs where project_id = '" + project_id + "' and type = 'TRANSCRIBE_EDIT_AUDIO' order by created_at desc limit 1),'missing'), coalesce((select status::text from jobs where project_id = '" + project_id + "' and type = 'REVISE_PLAN' order by created_at desc limit 1),'missing'), exists (select 1 from jobs where project_id = '" + project_id + "' and type = 'REVISE_PLAN' and started_at is not null);"
        result = subprocess.run(["psql", config.database_url, "-At", "-c", query], check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        fields = result.stdout.strip().split("|")
        if len(fields) != 3 or fields[2] not in {"t", "f"}:
            raise ValueError
        return {"edit": fields[0], "revision": fields[1], "revisionStarted": fields[2] == "t"}
    except (OSError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        raise CanaryError("harness_runtime") from exc


def run_fixture(action: str, config: Config, account_id: int) -> None:
    env = {**os.environ, "DATABASE_URL": config.database_url, "TG_POST_AGENT_CORRECTION_CANARY_ACCOUNT_ID": str(account_id)}
    try:
        subprocess.run(["node", str(FIXTURE_SCRIPT), action], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise CanaryError("fixture_db") from exc


def run_local_stage(category_name: str, work: Callable[..., T], *args) -> T:
    try:
        return work(*args)
    except BaseException as exc:
        raise CanaryError(category_name) from exc


def ensure_budget(needed: int) -> None:
    if read_ledger()["remainingBudget"] < needed:
        raise CanaryError("daily_budget")


def reserve_billable(category_name: str, provider: str, started: float) -> None:
    ledger = read_ledger()
    if ledger["remainingBudget"] < 1:
        raise CanaryError("daily_budget")
    ledger["entries"].append(entry(category_name, provider, True, started))
    ledger["attemptedBillableOperations"] += 1
    ledger["remainingBudget"] -= 1
    write_json(LEDGER_PATH, ledger)


def record_transport(category_name: str, started: float) -> None:
    ledger = read_ledger()
    ledger["entries"].append(entry(category_name, "telegram", False, started))
    write_json(LEDGER_PATH, ledger)


def entry(category_name: str, provider: str, billable: bool, started: float) -> dict[str, object]:
    return {"category": category_name, "provider": provider, "billable": billable, "outcome": "attempted", "elapsedSeconds": round(time.monotonic() - started, 2)}


def read_ledger() -> dict[str, object]:
    if not LEDGER_PATH.exists():
        return {"date": "2026-08-14", "timezone": "Europe/Moscow", "dailyBudget": 10, "attemptedBillableOperations": 0, "remainingBudget": 10, "entries": []}
    try:
        ledger = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CanaryError("ledger") from exc
    if not isinstance(ledger, dict) or ledger.get("dailyBudget") != 10 or not isinstance(ledger.get("attemptedBillableOperations"), int) or not isinstance(ledger.get("remainingBudget"), int) or not isinstance(ledger.get("entries"), list):
        raise CanaryError("ledger")
    return ledger


def report(status: str, failure: str | None, started: float, observations: Mapping[str, object]) -> dict[str, object]:
    ledger = read_ledger()
    return {"status": status, "failureCategory": failure, "canonicalTargetVerified": failure not in {"bot_identity", "target_identity_mismatch"}, "billableAttemptCount": ledger["attemptedBillableOperations"], "remainingDailyBudget": ledger["remainingBudget"], "elapsedSeconds": round(time.monotonic() - started, 2), **observations}


def write_json(path: Path, value: Mapping[str, object]) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(value, output, separators=(",", ":"), sort_keys=True)
        output.write("\n")
    os.chmod(path, 0o600)


def write_checkpoint(observations: Mapping[str, object]) -> None:
    write_json(CHECKPOINT_PATH, observations)


def write_lifecycle(statuses: Mapping[str, object], observations: Mapping[str, object]) -> None:
    write_json(
        LIFECYCLE_PATH,
        {
            "editJob": statuses["edit"],
            "revisionJob": statuses["revision"],
            "revisionStarted": statuses["revisionStarted"],
            "notificationObserved": observations["notificationObservation"] == "terminal",
        },
    )


def required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise CanaryError("configuration")
    return value


def positive_int(env: Mapping[str, str], name: str) -> int:
    try:
        value = int(required(env, name))
    except ValueError as exc:
        raise CanaryError("configuration") from exc
    if value < 1:
        raise CanaryError("configuration")
    return value


def bounded_int(env: Mapping[str, str], name: str, minimum: int, maximum: int) -> int:
    value = positive_int(env, name)
    if not minimum <= value <= maximum:
        raise CanaryError("configuration")
    return value


def bounded_float(env: Mapping[str, str], name: str, minimum: float, maximum: float) -> float:
    try:
        value = float(required(env, name))
    except ValueError as exc:
        raise CanaryError("configuration") from exc
    if not minimum <= value <= maximum:
        raise CanaryError("configuration")
    return value


def category(error: BaseException) -> str:
    if isinstance(error, CanaryError):
        return error.category
    if isinstance(error, BotIdentityError):
        return "bot_identity"
    if isinstance(error, CanonicalTargetMismatchError):
        return "target_identity_mismatch"
    if isinstance(error, UnauthorizedSessionError):
        return "unauthorized_session"
    return "harness_runtime"


def main() -> int:
    try:
        payload = asyncio.run(run(parse_config(os.environ)))
    except BaseException as error:
        payload = {"status": "failed", "failureCategory": category(error)}
    write_json(REPORT_PATH, payload)
    print(json.dumps(payload, separators=(",", ":"), sort_keys=True))
    return 0 if payload.get("status") == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
