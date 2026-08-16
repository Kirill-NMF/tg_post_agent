#!/usr/bin/env python3
"""Version-scoped delivery/export harness for one exact marker Option2 job."""
from __future__ import annotations
import asyncio
import json
import os
import subprocess
from pathlib import Path

from full_owner_voice_stage3_e2e import (
    CanaryError,
    callback,
    observe_callback,
    observe_document,
    persist_report,
    version_scoped_delivery_evidence,
)
from tg_post_agent_smoke import fetch_runtime_bot_identity, target_matches_canonical_identity

def document_is_nonempty(message: object) -> bool:
    return bool(getattr(getattr(message, "document", None), "size", 0) > 0)

def identity_preflight(authorized: bool, target_is_bot: bool, target_matches: bool, recipient_matches: bool) -> bool:
    return authorized and target_is_bot and target_matches and recipient_matches

def isolated_runner_ready(report: dict[str, object]) -> bool:
    return bool(
        report.get("processed")
        and report.get("jobSucceeded")
        and report.get("finalState")
        and report.get("formattedNonempty")
        and report.get("draftVersionMatched")
        and report.get("notificationSent")
        and report.get("lexicalPreserved")
        and int(report.get("permittedEmojiCount") or 0) >= 1
        and report.get("decorationPresent")
        and report.get("providerAttempted")
        and report.get("preflightMaxProviderAttempts") == 1
    )

async def run() -> dict[str, object]:
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    report: dict[str, object] = {
        "terminal": "not_observed",
        "isolatedJobSucceeded": False,
        "notificationSent": False,
        "currentFinalCount": 0,
        "currentTxtCount": 0,
        "noDuplicateFinal": False,
        "txtArtifactObserved": False,
        "doneClicked": False,
        "providerAttempts": 0,
        "exportProviderAttempts": 0,
        "lexicalPreserved": False,
        "permittedEmojiCount": 0,
        "decorationPresent": False,
        "txtArtifactNonempty": False,
        "recipientMatched": False,
        "botTargetMatched": False,
    }
    report_path = Path(os.environ.get("TG_POST_AGENT_FAILED_DECORATION_DELIVERY_REPORT", "/tmp/tg-post-agent-failed-decoration-delivery-report.json"))
    client = None
    try:
        client = TelegramClient(
            StringSession(os.environ["TG_POST_AGENT_REAL_TG_STRING_SESSION"]),
            int(os.environ["TG_POST_AGENT_REAL_TG_API_ID"]),
            os.environ["TG_POST_AGENT_REAL_TG_API_HASH"],
        )
        await client.connect()
        identity = await asyncio.to_thread(fetch_runtime_bot_identity, os.environ["TG_POST_AGENT_REAL_TG_BOT_TOKEN"])
        target = await client.get_entity(identity.username)
        account = await client.get_me()
        authorized = await client.is_user_authorized()
        target_matched = target_matches_canonical_identity(target.id, identity)
        recipient_matched = str(account.id) == os.environ.get("TG_POST_AGENT_REAL_TG_TEST_RECIPIENT_ID")
        if not identity_preflight(authorized, getattr(target, "bot", False), target_matched, recipient_matched):
            raise CanaryError("delivery_identity_mismatch")
        report["recipientMatched"] = True
        report["botTargetMatched"] = True
        if os.environ.get("TG_POST_AGENT_FAILED_DECORATION_PREFLIGHT_ONLY") == "true":
            report["terminal"] = "identity_preflight_passed"
            return report
        before = await client.get_messages(target, limit=40)
        format_cursor = max((message.id for message in before), default=0)
        runner = await asyncio.to_thread(
            subprocess.run,
            ["node", "scripts/telegram-e2e/single_stage_format_runner.mjs"],
            capture_output=True,
            text=True,
            check=False,
            env=os.environ.copy(),
        )
        runner_path = Path(os.environ["TG_POST_AGENT_SINGLE_STAGE_FORMAT_REPORT"])
        if runner.returncode != 0 or not runner_path.is_file():
            raise CanaryError("isolated_runner_failed")
        runner_report = json.loads(runner_path.read_text(encoding="utf-8"))
        report["providerAttempts"] = 1 if runner_report.get("providerAttempted") else 0
        report["notificationSent"] = bool(runner_report.get("notificationSent"))
        report["lexicalPreserved"] = bool(runner_report.get("lexicalPreserved"))
        report["permittedEmojiCount"] = int(runner_report.get("permittedEmojiCount") or 0)
        report["decorationPresent"] = bool(runner_report.get("decorationPresent"))
        if not isolated_runner_ready(runner_report):
            raise CanaryError("isolated_runner_terminal_invalid")
        report["isolatedJobSucceeded"] = True
        report["notificationSent"] = True
        final, done, _ = await observe_callback(client, target, identity.telegram_id, format_cursor, "final:accept", 90)
        after_final = await client.get_messages(target, limit=40)
        pre_export = version_scoped_delivery_evidence(after_final, identity.telegram_id, format_cursor, final.id)
        report.update(pre_export)
        if pre_export["currentFinalCount"] != 1:
            raise CanaryError("version_scoped_final_count_invalid")
        await final.click(data=done.data)
        report["doneClicked"] = True
        await observe_document(client, target, identity.telegram_id, final.id, 60)
        after_export = await client.get_messages(target, limit=40)
        report.update(version_scoped_delivery_evidence(after_export, identity.telegram_id, format_cursor, final.id))
        report["txtArtifactNonempty"] = any(document_is_nonempty(message) for message in after_export if message.id > final.id)
        if not report["noDuplicateFinal"] or not report["txtArtifactObserved"] or not report["txtArtifactNonempty"]:
            raise CanaryError("version_scoped_export_invalid")
        report["terminal"] = "final_exported"
    except CanaryError as error:
        report["terminal"] = "failed"
        report["category"] = error.category
    except Exception as error:
        report["terminal"] = "failed"
        report["category"] = type(error).__name__
    finally:
        try:
            persist_report(report_path, report)
        finally:
            if client is not None:
                await client.disconnect()
    return report

if __name__ == "__main__":
    print(json.dumps(asyncio.run(run()), sort_keys=True))
