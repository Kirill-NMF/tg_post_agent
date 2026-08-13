#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Mapping

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
LEDGER_PATH = Path("/tmp/tg-post-agent-billable-ledger-2026-08-14.json")
FIXTURE_SCRIPT = Path(__file__).with_name("correction_fixture.mjs")
TEST_CHAT_CONFIRMATION = "DEDICATED_TEST_CHAT"
FIXTURE_CONFIRMATION = "CREATE_AND_DELETE_DEDICATED_SYNTHETIC_FIXTURE_ONLY"
PLAN_MARKER = "\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u044e:"
SAFE_ERROR_MARKER = "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c"
TEXT_ACK_MARKER = "\u041f\u0440\u0438\u043d\u044f\u043b \u043f\u0440\u0430\u0432\u043a\u0443"
VOICE_ACK_MARKER = "\u0413\u043e\u043b\u043e\u0441\u043e\u0432\u0430\u044f \u043f\u0440\u0430\u0432\u043a\u0430 \u043f\u0440\u0438\u043d\u044f\u0442\u0430"
TEXT_EDIT = "\u0423\u0442\u043e\u0447\u043d\u0438\u0442\u0435 \u043f\u043b\u0430\u043d \u043a\u0430\u043a \u043e\u0434\u0438\u043d \u043a\u043e\u0440\u043e\u0442\u043a\u0438\u0439 \u043f\u043e\u0441\u0442."
VOICE_EDIT = "\u041e\u0441\u0442\u0430\u0432\u044c\u0442\u0435 \u043e\u0434\u0438\u043d \u043f\u043e\u0441\u0442 \u0438 \u0441\u0434\u0435\u043b\u0430\u0439\u0442\u0435 \u043f\u043b\u0430\u043d \u043a\u043e\u0440\u043e\u0447\u0435."


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
    )


async def run(config: Config) -> dict[str, object]:
    started = time.monotonic()
    observations = {"textAcknowledged": False, "textTerminal": "not_started", "textNoDuplicate": False, "voiceAcknowledged": False, "voiceTerminal": "not_started", "voiceNoDuplicate": False, "fixtureCleaned": False, "localAudioCleaned": False}
    client = None
    account_id: int | None = None
    status = "failed"
    failure: str | None = "runtime"
    try:
        ensure_budget(4)
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

        await asyncio.to_thread(run_fixture, "create", config, account_id)
        reserve("llm_plan_revision_text")
        observations["textAcknowledged"], observations["textTerminal"], observations["textNoDuplicate"] = await run_text_correction(client, target, identity.telegram_id, config)

        reserve("external_tts")
        with tempfile.TemporaryDirectory(prefix="tg-post-agent-correction-canary-") as directory:
            workspace = Path(directory)
            mp3 = workspace / "synthetic-edit.mp3"
            ogg = workspace / "synthetic-edit.ogg"
            await asyncio.to_thread(generate_tts, mp3)
            await asyncio.to_thread(convert_voice, mp3, ogg, config.max_audio_seconds)
            await asyncio.to_thread(validate_audio, ogg, config)
            reserve("stt_edit_transcription")
            reserve("llm_plan_revision_voice")
            observations["voiceAcknowledged"], observations["voiceTerminal"], observations["voiceNoDuplicate"] = await run_voice_correction(client, target, identity.telegram_id, config, ogg)
        observations["localAudioCleaned"] = True
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
    return report(status, failure, started, observations)


async def run_text_correction(client, target, bot_id: int, config: Config) -> tuple[bool, str, bool]:
    async with client.conversation(target, timeout=config.timeout_seconds, exclusive=True) as conversation:
        await conversation.send_message(TEXT_EDIT)
        acknowledgement = await receive(conversation, bot_id, config.timeout_seconds)
        if TEXT_ACK_MARKER not in (acknowledgement.raw_text or ""):
            raise CanaryError("text_acknowledgement")
        terminal = await terminal_response(conversation, bot_id, config.timeout_seconds)
        await assert_no_duplicate(conversation, config.duplicate_wait_seconds)
        return True, terminal, True


async def run_voice_correction(client, target, bot_id: int, config: Config, audio: Path) -> tuple[bool, str, bool]:
    async with client.conversation(target, timeout=config.timeout_seconds, exclusive=True) as conversation:
        await client.send_file(target, audio, voice_note=True)
        acknowledgement = await receive(conversation, bot_id, config.timeout_seconds)
        if VOICE_ACK_MARKER not in (acknowledgement.raw_text or ""):
            raise CanaryError("voice_acknowledgement")
        terminal = await terminal_response(conversation, bot_id, config.timeout_seconds)
        await assert_no_duplicate(conversation, config.duplicate_wait_seconds)
        return True, terminal, True


async def receive(conversation, bot_id: int, timeout: float):
    try:
        message = await asyncio.wait_for(conversation.get_response(), timeout=timeout)
    except TimeoutError as exc:
        raise CanaryError("timeout") from exc
    if message.sender_id != bot_id:
        raise CanaryError("unexpected_sender")
    return message


async def terminal_response(conversation, bot_id: int, timeout: float) -> str:
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise CanaryError("terminal_timeout")
        text = (await receive(conversation, bot_id, remaining)).raw_text or ""
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


def run_fixture(action: str, config: Config, account_id: int) -> None:
    env = {**os.environ, "DATABASE_URL": config.database_url, "TG_POST_AGENT_CORRECTION_CANARY_ACCOUNT_ID": str(account_id)}
    try:
        subprocess.run(["node", str(FIXTURE_SCRIPT), action], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise CanaryError("fixture") from exc


def ensure_budget(needed: int) -> None:
    ledger = read_ledger()
    if ledger["remainingBudget"] < needed:
        raise CanaryError("daily_budget")


def reserve(category: str) -> None:
    ledger = read_ledger()
    if ledger["remainingBudget"] < 1:
        raise CanaryError("daily_budget")
    ledger["entries"].append({"category": category, "outcome": "attempted"})
    ledger["attemptedBillableOperations"] += 1
    ledger["remainingBudget"] -= 1
    write_json(LEDGER_PATH, ledger)


def read_ledger() -> dict[str, object]:
    if not LEDGER_PATH.exists():
        return {"date": datetime.now().strftime("%Y-%m-%d"), "timezone": "Europe/Moscow", "dailyBudget": 10, "attemptedBillableOperations": 0, "remainingBudget": 10, "entries": []}
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
    return "runtime"


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
