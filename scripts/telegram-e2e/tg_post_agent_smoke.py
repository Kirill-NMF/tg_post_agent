#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

REPORT_PATH_DEFAULT = "/tmp/tg-post-agent-telegram-smoke-report.json"
REQUIRED_CONFIRMATION = "DEDICATED_TEST_CHAT"


class ConfigurationError(RuntimeError):
    pass


class SmokeTimeoutError(RuntimeError):
    pass


class DuplicateResponseError(RuntimeError):
    pass


class UnexpectedBotResponseError(RuntimeError):
    def __init__(self, category: str):
        self.category = category
        self.bot_reply_observed = True
        super().__init__(category)


class UnauthorizedSessionError(RuntimeError):
    pass


@dataclass(frozen=True)
class SmokeConfig:
    api_id: int
    api_hash: str = field(repr=False)
    string_session: str = field(repr=False)
    bot_username: str
    test_target_chat_id: int
    expected_intake_fragment: str
    timeout_seconds: float
    duplicate_wait_seconds: float


def parse_config(env: Mapping[str, str]) -> SmokeConfig:
    if env.get("TG_POST_AGENT_REAL_TG_SMOKE_ENABLED", "").lower() != "true":
        raise ConfigurationError("TG_POST_AGENT_REAL_TG_SMOKE_ENABLED must be true.")

    confirmation = required(env, "TG_POST_AGENT_REAL_TG_TEST_TARGET_CONFIRMATION")
    if confirmation != REQUIRED_CONFIRMATION:
        raise ConfigurationError(
            "TG_POST_AGENT_REAL_TG_TEST_TARGET_CONFIRMATION must equal DEDICATED_TEST_CHAT."
        )

    return SmokeConfig(
        api_id=required_positive_int(env, "TG_POST_AGENT_REAL_TG_API_ID"),
        api_hash=required(env, "TG_POST_AGENT_REAL_TG_API_HASH"),
        string_session=required(env, "TG_POST_AGENT_REAL_TG_STRING_SESSION"),
        bot_username=required(env, "TG_POST_AGENT_REAL_TG_BOT_USERNAME"),
        test_target_chat_id=required_int(env, "TG_POST_AGENT_REAL_TG_TEST_TARGET_CHAT_ID"),
        expected_intake_fragment=required_bounded_text(
            env, "TG_POST_AGENT_REAL_TG_EXPECTED_INTAKE_FRAGMENT", 200
        ),
        timeout_seconds=required_bounded_float(
            env, "TG_POST_AGENT_REAL_TG_TIMEOUT_SECONDS", minimum=1, maximum=120
        ),
        duplicate_wait_seconds=required_bounded_float(
            env, "TG_POST_AGENT_REAL_TG_DUPLICATE_WAIT_SECONDS", minimum=1, maximum=30
        ),
    )


async def run_smoke(config: SmokeConfig) -> dict[str, object]:
    try:
        from telethon import TelegramClient
        from telethon.sessions import StringSession
    except ImportError as exc:
        raise ConfigurationError("Telethon is not installed for the opt-in smoke harness.") from exc

    client = TelegramClient(
        StringSession(config.string_session),
        config.api_id,
        config.api_hash,
        flood_sleep_threshold=0,
    )
    await client.connect()

    try:
        if not await client.is_user_authorized():
            raise UnauthorizedSessionError("Configured Telethon session is not authorized.")

        bot = await client.get_entity(config.bot_username)
        target = await client.get_entity(config.test_target_chat_id)
        async with client.conversation(target, timeout=config.timeout_seconds, exclusive=True) as conversation:
            await conversation.send_message("/start")
            try:
                response = await asyncio.wait_for(
                    conversation.get_response(), timeout=config.timeout_seconds
                )
            except TimeoutError as exc:
                raise SmokeTimeoutError() from exc

            if response.sender_id != bot.id:
                raise UnexpectedBotResponseError("unexpected_sender")
            if config.expected_intake_fragment not in (response.raw_text or ""):
                raise UnexpectedBotResponseError("intake_fragment_mismatch")

            try:
                await asyncio.wait_for(
                    conversation.get_response(), timeout=config.duplicate_wait_seconds
                )
            except TimeoutError:
                return {
                    "status": "passed",
                    "targetConfigured": True,
                    "botReplyObserved": True,
                    "duplicateResponseObserved": False,
                    "failureCategory": None,
                }

            raise DuplicateResponseError()
    finally:
        await client.disconnect()


def report_for_error(
    error: BaseException,
    *,
    target_configured: bool,
    bot_reply_observed: bool,
    duplicate_response_observed: bool,
) -> dict[str, object]:
    return {
        "status": "failed",
        "targetConfigured": target_configured,
        "botReplyObserved": bot_reply_observed,
        "duplicateResponseObserved": duplicate_response_observed,
        "failureCategory": failure_category(error),
    }


def failure_category(error: BaseException) -> str:
    if isinstance(error, ConfigurationError):
        return "configuration"
    if isinstance(error, SmokeTimeoutError):
        return "timeout"
    if isinstance(error, DuplicateResponseError):
        return "duplicate_response"
    if isinstance(error, UnauthorizedSessionError):
        return "unauthorized_session"
    if isinstance(error, UnexpectedBotResponseError):
        return error.category
    return "runtime"


def write_report(path: Path, report: Mapping[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(report, output, separators=(",", ":"), sort_keys=True)
        output.write("\n")
    os.chmod(path, 0o600)


@contextmanager
def single_run_lock():
    lock_path = Path(tempfile.gettempdir()) / "tg-post-agent-telegram-smoke.lock"
    with lock_path.open("w", encoding="utf-8") as lock_file:
        try:
            import fcntl

            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ConfigurationError("Another Telegram smoke run is already active.") from exc
        yield


def report_path(env: Mapping[str, str]) -> Path:
    raw = env.get("TG_POST_AGENT_REAL_TG_REPORT_PATH", REPORT_PATH_DEFAULT).strip()
    path = Path(raw)
    if not path.is_absolute():
        raise ConfigurationError("TG_POST_AGENT_REAL_TG_REPORT_PATH must be absolute.")
    return path


def required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise ConfigurationError(f"{name} is required.")
    return value


def required_int(env: Mapping[str, str], name: str) -> int:
    value = required(env, name)
    try:
        result = int(value)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be an integer.") from exc
    if result == 0:
        raise ConfigurationError(f"{name} must not be zero.")
    return result


def required_positive_int(env: Mapping[str, str], name: str) -> int:
    result = required_int(env, name)
    if result < 1:
        raise ConfigurationError(f"{name} must be positive.")
    return result


def required_bounded_float(
    env: Mapping[str, str], name: str, *, minimum: float, maximum: float
) -> float:
    value = required(env, name)
    try:
        result = float(value)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be numeric.") from exc
    if not minimum <= result <= maximum:
        raise ConfigurationError(f"{name} must be between {minimum:g} and {maximum:g}.")
    return result


def required_bounded_text(env: Mapping[str, str], name: str, maximum: int) -> str:
    value = required(env, name)
    if len(value) > maximum:
        raise ConfigurationError(f"{name} exceeds {maximum} characters.")
    return value


def main() -> int:
    env = os.environ
    path = report_path(env)
    try:
        config = parse_config(env)
        with single_run_lock():
            report = asyncio.run(run_smoke(config))
    except BaseException as error:
        report = report_for_error(
            error,
            target_configured=bool(env.get("TG_POST_AGENT_REAL_TG_TEST_TARGET_CHAT_ID", "").strip()),
            bot_reply_observed=getattr(error, "bot_reply_observed", False),
            duplicate_response_observed=isinstance(error, DuplicateResponseError),
        )
        write_report(path, report)
        print(json.dumps(report, separators=(",", ":"), sort_keys=True), file=sys.stderr)
        return 2

    write_report(path, report)
    print(json.dumps(report, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
