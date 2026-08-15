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
        if not await client.is_user_authorized() or not getattr(target, "bot", False) or not target_matches_canonical_identity(target.id, identity): raise CanaryError("target_or_session")
        async with client.conversation(target, timeout=180, exclusive=True) as c:
            await c.send_message("/start"); await receive_message(c, identity.telegram_id, 60); report["stages"].append("start")
            await client.send_file(target, os.environ["TG_POST_AGENT_OWNER_AUDIO_COPY"], voice_note=True); report["stages"].append("audio_uploaded")
            plan, choice = await receive_until(c, identity.telegram_id, "plan:", 180); await plan.click(data=choice.data); report["stages"].append("plan_clicked")
            mode, choice = await receive_until(c, identity.telegram_id, "rewrite:", 180); await mode.click(data=choice.data); report["stages"].append("mode_clicked")
            draft, choice = await receive_until(c, identity.telegram_id, "format:open", 180); draft_text = draft.raw_text or ""; await draft.click(data=choice.data); report["stages"].append("draft_ready")
            options, choice = await receive_until(c, identity.telegram_id, "format:option_2", 60); await options.click(data=choice.data); report["stages"].append("option2_clicked")
            final, choice = await receive_until(c, identity.telegram_id, "final:accept", 180)
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
