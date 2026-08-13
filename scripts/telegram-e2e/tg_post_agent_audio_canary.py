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
from pathlib import Path
from typing import Mapping
from urllib.parse import quote
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).parent))

from tg_post_agent_smoke import (
    BotIdentityError,
    CanonicalTargetMismatchError,
    UnauthorizedSessionError,
    fetch_runtime_bot_identity,
    target_matches_canonical_identity,
)

REPORT_PATH = Path("/tmp/tg-post-agent-audio-canary-report.json")
TEST_CHAT_CONFIRMATION = "DEDICATED_TEST_CHAT"
CLEANUP_CONFIRMATION = "DELETE_DEDICATED_TEST_ACCOUNT_ONLY"
SYNTHETIC_TEXT = "\u042d\u0442\u043e \u0442\u0435\u0441\u0442\u043e\u0432\u043e\u0435 \u0433\u043e\u043b\u043e\u0441\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u0434\u043b\u044f \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u0440\u0430\u0431\u043e\u0442\u044b \u0431\u043e\u0442\u0430."
PLAN_MARKER = "\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u044e:"
SAFE_ERROR_MARKER = "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c"


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
    test_target_chat_id: int
    database_url: str = field(repr=False)
    expected_intake_fragment: str
    timeout_seconds: float
    max_audio_seconds: float
    max_audio_bytes: int


def parse_config(env: Mapping[str, str]) -> Config:
    if env.get("TG_POST_AGENT_AUDIO_CANARY_ENABLED", "").lower() != "true":
        raise CanaryError("configuration")
    if required(env, "TG_POST_AGENT_REAL_TG_TEST_TARGET_CONFIRMATION") != TEST_CHAT_CONFIRMATION:
        raise CanaryError("configuration")
    if required(env, "TG_POST_AGENT_AUDIO_CANARY_CLEANUP_CONFIRMATION") != CLEANUP_CONFIRMATION:
        raise CanaryError("configuration")
    database_url = required(env, "DATABASE_URL")
    if "tg_post_agent" not in database_url or "tg_post_agent_test" in database_url:
        raise CanaryError("configuration")
    return Config(
        api_id=positive_int(env, "TG_POST_AGENT_REAL_TG_API_ID"),
        api_hash=required(env, "TG_POST_AGENT_REAL_TG_API_HASH"),
        string_session=required(env, "TG_POST_AGENT_REAL_TG_STRING_SESSION"),
        bot_token=required(env, "TG_POST_AGENT_REAL_TG_BOT_TOKEN"),
        test_target_chat_id=positive_int(env, "TG_POST_AGENT_REAL_TG_TEST_TARGET_CHAT_ID"),
        database_url=database_url,
        expected_intake_fragment=bounded_text(env, "TG_POST_AGENT_REAL_TG_EXPECTED_INTAKE_FRAGMENT", 200),
        timeout_seconds=bounded_float(env, "TG_POST_AGENT_AUDIO_CANARY_TIMEOUT_SECONDS", 20, 180),
        max_audio_seconds=bounded_float(env, "TG_POST_AGENT_AUDIO_CANARY_MAX_SECONDS", 1, 8),
        max_audio_bytes=bounded_int(env, "TG_POST_AGENT_AUDIO_CANARY_MAX_BYTES", 1, 512 * 1024),
    )


async def run(config: Config) -> dict[str, object]:
    started_at = time.monotonic()
    audio_sent = False
    intake_seen = False
    local_cleaned = False
    projects_cleaned = False
    workspace_created = False
    client = None
    try:
        identity = await asyncio.to_thread(fetch_runtime_bot_identity, config.bot_token)
        from telethon import TelegramClient
        from telethon.sessions import StringSession

        client = TelegramClient(StringSession(config.string_session), config.api_id, config.api_hash, flood_sleep_threshold=0)
        await client.connect()
        if not await client.is_user_authorized():
            raise UnauthorizedSessionError("unauthorized session")
        account = await client.get_me()
        target = await client.get_entity(identity.username)
        if (
            not getattr(target, "bot", False)
            or not target_matches_canonical_identity(target.id, identity)
            or not target_matches_canonical_identity(config.test_target_chat_id, identity)
        ):
            raise CanonicalTargetMismatchError()

        await asyncio.to_thread(cleanup_test_account, config.database_url, account.id)
        projects_cleaned = True
        workspace_created = True
        with tempfile.TemporaryDirectory(prefix="tg-post-agent-audio-canary-") as directory:
            workspace = Path(directory)
            mp3 = workspace / "synthetic-ru.mp3"
            ogg = workspace / "synthetic-ru.ogg"
            await asyncio.to_thread(generate_tts, mp3)
            await asyncio.to_thread(convert_voice, mp3, ogg, config.max_audio_seconds)
            validate_audio(ogg, config)

            async with client.conversation(target, timeout=config.timeout_seconds, exclusive=True) as conversation:
                await conversation.send_message("/start")
                intake = await receive(conversation, identity.telegram_id, config.timeout_seconds)
                if config.expected_intake_fragment not in (intake.raw_text or ""):
                    raise CanaryError("intake_fragment_mismatch")
                intake_seen = True

                await client.send_file(target, ogg, voice_note=True)
                audio_sent = True
                outcome = await await_terminal_response(conversation, identity.telegram_id, config.timeout_seconds)

        local_cleaned = True
        await asyncio.to_thread(cleanup_test_account, config.database_url, account.id)
        projects_cleaned = True
        return report(
            status="passed" if outcome == "planning_response" else "safe_error",
            category=None if outcome == "planning_response" else "safe_recovery",
            elapsed=time.monotonic() - started_at,
            intake_seen=intake_seen,
            audio_sent=audio_sent,
            planning_seen=outcome == "planning_response",
            recovery_seen=outcome == "safe_error",
            local_cleaned=local_cleaned,
            projects_cleaned=projects_cleaned,
        )
    except BaseException as error:
        local_audio_cleaned = local_audio_cleaned or workspace_created
        if "account" in locals():
            try:
                await asyncio.to_thread(cleanup_test_account, config.database_url, account.id)
                projects_cleaned = True
            except CanaryError:
                error = CanaryError("cleanup")
        return report(
            status="failed",
            category=category(error),
            elapsed=time.monotonic() - started_at,
            intake_seen=intake_seen,
            audio_sent=audio_sent,
            planning_seen=False,
            recovery_seen=False,
            local_cleaned=local_cleaned,
            projects_cleaned=projects_cleaned,
        )
    finally:
        if client:
            await client.disconnect()


async def receive(conversation, bot_id: int, timeout_seconds: float):
    try:
        message = await asyncio.wait_for(conversation.get_response(), timeout=timeout_seconds)
    except TimeoutError as exc:
        raise CanaryError("timeout") from exc
    if message.sender_id != bot_id:
        raise CanaryError("unexpected_sender")
    return message


async def await_terminal_response(conversation, bot_id: int, timeout_seconds: float) -> str:
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    while True:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise CanaryError("planning_timeout")
        message = await receive(conversation, bot_id, remaining)
        text = message.raw_text or ""
        if PLAN_MARKER in text:
            return "planning_response"
        if SAFE_ERROR_MARKER in text:
            return "safe_error"


def generate_tts(destination: Path) -> None:
    request = Request(
        "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ru&q=" + quote(SYNTHETIC_TEXT, safe=""),
        headers={"User-Agent": "Mozilla/5.0"},
    )
    try:
        with urlopen(request, timeout=20) as response:
            destination.write_bytes(response.read())
    except OSError as exc:
        raise CanaryError("tts") from exc
    if not destination.exists() or destination.stat().st_size < 1:
        raise CanaryError("tts")


def convert_voice(source: Path, destination: Path, max_seconds: float) -> None:
    try:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-i", str(source), "-t", str(max_seconds), "-ac", "1", "-c:a", "libopus", "-b:a", "32k", str(destination)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise CanaryError("audio_validation") from exc


def validate_audio(path: Path, config: Config) -> None:
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", str(path)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        duration = float(probe.stdout.strip())
    except (OSError, subprocess.CalledProcessError, ValueError) as exc:
        raise CanaryError("audio_validation") from exc
    if not path.is_file() or not 1 <= path.stat().st_size <= config.max_audio_bytes or not 0 < duration <= config.max_audio_seconds:
        raise CanaryError("audio_validation")


def cleanup_command(database_url: str, telegram_user_id: int) -> list[str]:
    return ["psql", database_url, "-v", "ON_ERROR_STOP=1", "-q", "-c", f"delete from users where telegram_user_id = {int(telegram_user_id)};"]

def cleanup_test_account(database_url: str, telegram_user_id: int) -> None:
    try:
        subprocess.run(
            cleanup_command(database_url, telegram_user_id),
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise CanaryError("cleanup") from exc


def report(*, status: str, category: str | None, elapsed: float, intake_seen: bool, audio_sent: bool, planning_seen: bool, recovery_seen: bool, local_cleaned: bool, projects_cleaned: bool) -> dict[str, object]:
    return {
        "status": status,
        "canonicalTargetVerified": category not in {"bot_identity", "target_identity_mismatch"},
        "ttsProvider": "google_translate",
        "intakePromptObserved": intake_seen,
        "sourceAudioSent": audio_sent,
        "planningResponseObserved": planning_seen,
        "safeRecoveryObserved": recovery_seen,
        "localAudioCleaned": local_cleaned,
        "projectArtifactsCleaned": projects_cleaned,
        "elapsedSeconds": round(elapsed, 2),
        "failureCategory": category,
    }


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


def write_report(payload: Mapping[str, object]) -> None:
    descriptor = os.open(REPORT_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(payload, output, separators=(",", ":"), sort_keys=True)
        output.write("\n")
    os.chmod(REPORT_PATH, 0o600)


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


def bounded_text(env: Mapping[str, str], name: str, maximum: int) -> str:
    value = required(env, name)
    if len(value) > maximum:
        raise CanaryError("configuration")
    return value


def main() -> int:
    try:
        payload = asyncio.run(run(parse_config(os.environ)))
    except BaseException as error:
        payload = report(status="failed", category=category(error), elapsed=0, intake_seen=False, audio_sent=False, planning_seen=False, recovery_seen=False, local_cleaned=False, projects_cleaned=False)
    write_report(payload)
    print(json.dumps(payload, separators=(",", ":"), sort_keys=True))
    return 0 if payload["status"] == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())