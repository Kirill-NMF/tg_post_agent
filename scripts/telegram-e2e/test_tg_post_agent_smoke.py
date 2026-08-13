import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from tg_post_agent_smoke import (
    ConfigurationError,
    DuplicateResponseError,
    SmokeTimeoutError,
    UnexpectedBotResponseError,
    parse_config,
    report_for_error,
    write_report,
)


def valid_env() -> dict[str, str]:
    return {
        "TG_POST_AGENT_REAL_TG_SMOKE_ENABLED": "true",
        "TG_POST_AGENT_REAL_TG_API_ID": "12345",
        "TG_POST_AGENT_REAL_TG_API_HASH": "api-hash",
        "TG_POST_AGENT_REAL_TG_STRING_SESSION": "session",
        "TG_POST_AGENT_REAL_TG_BOT_USERNAME": "@example_bot",
        "TG_POST_AGENT_REAL_TG_TEST_TARGET_CHAT_ID": "123456",
        "TG_POST_AGENT_REAL_TG_TEST_TARGET_CONFIRMATION": "DEDICATED_TEST_CHAT",
        "TG_POST_AGENT_REAL_TG_EXPECTED_INTAKE_FRAGMENT": "intake prompt",
        "TG_POST_AGENT_REAL_TG_TIMEOUT_SECONDS": "30",
        "TG_POST_AGENT_REAL_TG_DUPLICATE_WAIT_SECONDS": "4",
    }


class SmokeContractTests(unittest.TestCase):
    def test_requires_explicit_enabled_test_target_and_confirmation(self) -> None:
        env = valid_env()
        del env["TG_POST_AGENT_REAL_TG_TEST_TARGET_CHAT_ID"]

        with self.assertRaisesRegex(ConfigurationError, "TEST_TARGET_CHAT_ID"):
            parse_config(env)

        env = valid_env()
        env["TG_POST_AGENT_REAL_TG_TEST_TARGET_CONFIRMATION"] = "no"

        with self.assertRaisesRegex(ConfigurationError, "CONFIRMATION"):
            parse_config(env)

    def test_rejects_unbounded_or_invalid_timeouts(self) -> None:
        env = valid_env()
        env["TG_POST_AGENT_REAL_TG_TIMEOUT_SECONDS"] = "0"

        with self.assertRaisesRegex(ConfigurationError, "TIMEOUT_SECONDS"):
            parse_config(env)

        env = valid_env()
        env["TG_POST_AGENT_REAL_TG_DUPLICATE_WAIT_SECONDS"] = "121"

        with self.assertRaisesRegex(ConfigurationError, "DUPLICATE_WAIT_SECONDS"):
            parse_config(env)

    def test_writes_transcript_free_diagnostic_report_with_owner_only_mode(self) -> None:
        report = report_for_error(
            SmokeTimeoutError(),
            target_configured=True,
            bot_reply_observed=False,
            duplicate_response_observed=False,
        )

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.json"
            write_report(path, report)
            content = path.read_text(encoding="utf-8")
            parsed = json.loads(content)

            self.assertEqual(parsed["status"], "failed")
            self.assertEqual(parsed["failureCategory"], "timeout")
            self.assertNotIn("api-hash", content)
            self.assertNotIn("session", content)
            self.assertNotIn("intake prompt", content)
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)

    def test_classifies_duplicate_response_without_message_content(self) -> None:
        report = report_for_error(
            DuplicateResponseError(),
            target_configured=True,
            bot_reply_observed=True,
            duplicate_response_observed=True,
        )

        self.assertEqual(report["failureCategory"], "duplicate_response")
        self.assertEqual(report["botReplyObserved"], True)
        self.assertEqual(report["duplicateResponseObserved"], True)


    def test_classifies_safe_unexpected_response_reason_without_message_content(self) -> None:
        report = report_for_error(
            UnexpectedBotResponseError("intake_fragment_mismatch"),
            target_configured=True,
            bot_reply_observed=True,
            duplicate_response_observed=False,
        )

        self.assertEqual(report["failureCategory"], "intake_fragment_mismatch")
        self.assertEqual(report["botReplyObserved"], True)
        self.assertNotIn("intake prompt", json.dumps(report))

if __name__ == "__main__":
    unittest.main()
