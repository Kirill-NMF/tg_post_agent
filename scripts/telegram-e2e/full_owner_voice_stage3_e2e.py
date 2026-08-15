#!/usr/bin/env python3
"""Fail-closed, category-only full owner-voice Stage 1→3 Telethon harness."""
from __future__ import annotations
import asyncio
import json
import os
import hashlib
import re
import sys
import tempfile
import subprocess
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from tg_post_agent_smoke import fetch_runtime_bot_identity, target_matches_canonical_identity

class CanaryError(RuntimeError):
    def __init__(self, category: str): self.category = category; super().__init__(category)

def persist_report(path: Path, report: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(report, handle, sort_keys=True); handle.write("\n"); handle.flush(); os.fsync(handle.fileno()); temp = Path(handle.name)
    temp.replace(path)

def callback(message, prefix: str):
    for row in getattr(getattr(message, "reply_markup", None), "rows", []) or []:
        for button in getattr(row, "buttons", []) or []:
            if getattr(button, "data", b"").decode().startswith(prefix): return button
    return None

def recipient_matches(account_id: int, configured_recipient: str | None) -> bool:
    return bool(configured_recipient and configured_recipient.isdigit() and int(configured_recipient) == account_id)

def persisted_scope(account_id: int, started_at: float) -> dict[str, object]:
    run = subprocess.run(["node", "scripts/telegram-e2e/project_recipient_scope.mjs"], env={**os.environ, "TG_POST_AGENT_E2E_USER_ID": str(account_id), "TG_POST_AGENT_E2E_STARTED_AT": str(started_at)}, capture_output=True, text=True, check=True)
    return json.loads(run.stdout)

def scope_is_eligible(scope: dict[str, object], account_id: int) -> bool:
    return bool(scope.get("found")) and recipient_matches(account_id, scope.get("recipient") if isinstance(scope.get("recipient"), str) else None)

def select_scope(rows, account_id: int, started_at: float):
    eligible = [row for row in rows if row["user"] == account_id and row["created"] >= started_at]
    return max(eligible, key=lambda row: row["created"], default=None)

async def wait_for_scope(fetch, account_id: int, cursor: int, deadline: float = 10.0, interval: float = 0.5, clock=asyncio.get_running_loop):
    loop = clock()
    end = loop.time() + deadline
    while True:
        scope = await asyncio.to_thread(fetch, account_id, cursor)
        if scope.get("found") or loop.time() >= end: return scope
        await asyncio.sleep(interval)

def newer_callback_prefixes(messages, cursor: int) -> list[str]:
    return [getattr(button, "data", b"").decode().split(":", 1)[0] for message in sorted((m for m in messages if m.id > cursor), key=lambda item: item.id) for row in getattr(getattr(message, "reply_markup", None), "rows", []) or [] for button in getattr(row, "buttons", []) or []]

async def receive_until(conversation, bot_id: int, prefix: str, timeout: float):
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0: raise CanaryError(prefix.replace(":", "_") + "_timeout")
        message = await asyncio.wait_for(conversation.get_response(), remaining)
        if message.sender_id != bot_id: raise CanaryError("unexpected_sender")
        choice = callback(message, prefix)
        if choice: return message, choice

async def receive_message(conversation, bot_id: int, timeout: float):
    message = await asyncio.wait_for(conversation.get_response(), timeout)
    if message.sender_id != bot_id: raise CanaryError("unexpected_sender")
    return message

async def observe_callback(client, target, bot_id: int, after_id: int, prefix: str, timeout: float):
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        messages = await client.get_messages(target, limit=40)
        current = sorted((m for m in messages if m.sender_id == bot_id and m.id > after_id), key=lambda message: message.id)
        for message in current:
            choice = callback(message, prefix)
            if choice: return message, choice, {"callbackPrefix": prefix, "newBotMessageCount": len(current), "cursorAdvanced": True}
        await asyncio.sleep(1)
    raise CanaryError(prefix.replace(":", "_") + "_timeout")

def lexical_fingerprint(text: str) -> tuple[bool, str, int]:
    """Compare lexical units only; Markdown markers and emoji are decorations."""
    units = re.findall(r"[^\W_]+", text, flags=re.UNICODE)
    return bool(units), hashlib.sha256("\u001f".join(units).encode()).hexdigest()[:16], len(units)

async def no_duplicate_terminal(conversation, timeout: float = 3.0) -> bool:
    try:
        await asyncio.wait_for(conversation.get_response(), timeout)
        return False
    except TimeoutError:
        return True

async def run() -> dict[str, object]:
    """Execute /start→owner voice→plan→mode→draft→format option 2 once."""
    from telethon import TelegramClient
    from telethon.sessions import StringSession
    report: dict[str, object] = {"stages": [], "terminal": "not_observed", "cleanupAudio": False, "sttCalls": 0, "planCalls": 0, "draftCalls": 0, "option2Calls": 0}
    audio = Path(os.environ.get("TG_POST_AGENT_OWNER_AUDIO_COPY", ""))
    report_path = Path(os.environ.get("TG_POST_AGENT_FULL_E2E_REPORT", "/tmp/tg-post-agent-full-owner-e2e-report.json"))
    client = TelegramClient(StringSession(os.environ["TG_POST_AGENT_REAL_TG_STRING_SESSION"]), int(os.environ["TG_POST_AGENT_REAL_TG_API_ID"]), os.environ["TG_POST_AGENT_REAL_TG_API_HASH"])
    try:
        await client.connect()
        identity = await asyncio.to_thread(fetch_runtime_bot_identity, os.environ["TG_POST_AGENT_REAL_TG_BOT_TOKEN"])
        target = await client.get_entity(identity.username)
        account = await client.get_me()
        configured_recipient = os.environ.get("TG_POST_AGENT_REAL_TG_TEST_RECIPIENT_ID")
        if configured_recipient is None:
            os.environ["TG_POST_AGENT_REAL_TG_TEST_RECIPIENT_ID"] = str(account.id)
            configured_recipient = os.environ["TG_POST_AGENT_REAL_TG_TEST_RECIPIENT_ID"]
        if not recipient_matches(account.id, configured_recipient): raise CanaryError("recipient_identity_mismatch")
        if not await client.is_user_authorized() or not getattr(target, "bot", False) or not target_matches_canonical_identity(target.id, identity): raise CanaryError("target_or_session")
        async with client.conversation(target, timeout=180, exclusive=True) as c:
            await c.send_message("/start"); await receive_message(c, identity.telegram_id, 60); report["stages"].append("start")
            run_started = time.time(); outgoing = await c.send_file(os.environ["TG_POST_AGENT_OWNER_AUDIO_COPY"], voice_note=True); cursor = outgoing.id; report["stages"].append("audio_uploaded")
            scope = await wait_for_scope(persisted_scope, account.id, run_started)
            report["projectScopeFound"] = bool(scope.get("found")); report["projectStateCategory"] = scope.get("state")
            if not scope_is_eligible(scope, account.id): raise CanaryError("project_recipient_mismatch")
            plan, choice, evidence = await observe_callback(client, target, identity.telegram_id, cursor, "plan:", 180); report["planUiObserved"] = True; report["planUiEvidence"] = evidence; await plan.click(data=choice.data); cursor = plan.id; report["stages"].append("plan_clicked")
            mode, choice, evidence = await observe_callback(client, target, identity.telegram_id, cursor, "rewrite:", 180); report["rewriteUiObserved"] = True; report["rewriteUiEvidence"] = evidence; await mode.click(data=choice.data); cursor = mode.id; report["stages"].append("mode_clicked")
            draft, choice, evidence = await observe_callback(client, target, identity.telegram_id, cursor, "format:open", 180); report["draftUiObserved"] = True; report["draftUiEvidence"] = evidence; draft_text = draft.raw_text or ""; await draft.click(data=choice.data); cursor = draft.id; report["stages"].append("draft_ready")
            options, choice, evidence = await observe_callback(client, target, identity.telegram_id, cursor, "format:option_2", 60); report["formatUiObserved"] = True; report["formatUiEvidence"] = evidence; await options.click(data=choice.data); cursor = options.id; report["stages"].append("option2_clicked")
            final, choice, evidence = await observe_callback(client, target, identity.telegram_id, cursor, "final:accept", 180); report["finalUiObserved"] = True; report["finalUiEvidence"] = evidence
            draft_nonempty, draft_hash, draft_units = lexical_fingerprint(draft_text)
            final_nonempty, final_hash, final_units = lexical_fingerprint(final.raw_text or "")
            report.update({"lexicalPreserved": draft_nonempty and final_nonempty and draft_hash == final_hash and draft_units == final_units, "draftLexicalHash": draft_hash, "finalLexicalHash": final_hash, "draftLexicalUnits": draft_units, "finalLexicalUnits": final_units, "noDuplicateTerminal": await no_duplicate_terminal(c)})
            report["terminal"] = "final"; report["stages"].append("option2_final")
    except CanaryError as error: report["terminal"] = "failed"; report["category"] = error.category
    except Exception as error: report["terminal"] = "failed"; report["category"] = type(error).__name__
    finally:
        try:
            if audio.is_file(): audio.unlink()
            report["cleanupAudio"] = not audio.exists()
        finally:
            try: persist_report(report_path, report)
            finally: await client.disconnect()
    return report

if __name__ == "__main__": print(json.dumps(asyncio.run(run())))
