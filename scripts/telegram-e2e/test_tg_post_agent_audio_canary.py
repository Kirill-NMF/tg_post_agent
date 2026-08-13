import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from tg_post_agent_audio_canary import CanaryError, cleanup_command, parse_config, report


def valid_env() -> dict[str, str]:
    return {
        "TG_POST_AGENT_AUDIO_CANARY_ENABLED": "true",
        "TG_POST_AGENT_REAL_TG_TEST_TARGET_CONFIRMATION": "DEDICATED_TEST_CHAT",
        "TG_POST_AGENT_AUDIO_CANARY_CLEANUP_CONFIRMATION": "DELETE_DEDICATED_TEST_ACCOUNT_ONLY",
        "TG_POST_AGENT_REAL_TG_API_ID": "12345",
        "TG_POST_AGENT_REAL_TG_API_HASH": "api-hash",
        "TG_POST_AGENT_REAL_TG_STRING_SESSION": "session",
        "TG_POST_AGENT_REAL_TG_BOT_TOKEN": "bot-token",
        "TG_POST_AGENT_REAL_TG_TEST_TARGET_CHAT_ID": "123456",
        "DATABASE_URL": "postgresql:///tg_post_agent?host=/var/run/postgresql",
        "TG_POST_AGENT_REAL_TG_EXPECTED_INTAKE_FRAGMENT": "intake prompt",
        "TG_POST_AGENT_AUDIO_CANARY_TIMEOUT_SECONDS": "60",
        "TG_POST_AGENT_AUDIO_CANARY_MAX_SECONDS": "8",
        "TG_POST_AGENT_AUDIO_CANARY_MAX_BYTES": "524288",
    }


class AudioCanaryContractTests(unittest.TestCase):
    def test_requires_explicit_test_and_cleanup_guards(self) -> None:
        env = valid_env()
        env["TG_POST_AGENT_AUDIO_CANARY_ENABLED"] = "false"
        with self.assertRaises(CanaryError):
            parse_config(env)

        env = valid_env()
        env["TG_POST_AGENT_AUDIO_CANARY_CLEANUP_CONFIRMATION"] = "no"
        with self.assertRaises(CanaryError):
            parse_config(env)

    def test_refuses_test_database_and_unbounded_audio(self) -> None:
        env = valid_env()
        env["DATABASE_URL"] = "postgresql:///tg_post_agent_test?host=/var/run/postgresql"
        with self.assertRaises(CanaryError):
            parse_config(env)

        env = valid_env()
        env["TG_POST_AGENT_AUDIO_CANARY_MAX_SECONDS"] = "9"
        with self.assertRaises(CanaryError):
            parse_config(env)

    def test_builds_numeric_only_cleanup_command(self) -> None:
        command = cleanup_command("postgresql:///tg_post_agent?host=/var/run/postgresql", 123456)
        self.assertNotIn("telegram_user_id=123456", command)
        self.assertEqual(command[-1], "delete from users where telegram_user_id = 123456;")

    def test_report_contains_only_safe_outcomes(self) -> None:
        payload = report(
            status="passed",
            category=None,
            elapsed=1.234,
            intake_seen=True,
            audio_sent=True,
            planning_seen=True,
            recovery_seen=False,
            local_cleaned=True,
            projects_cleaned=True,
        )
        encoded = json.dumps(payload)

        self.assertEqual(payload["status"], "passed")
        self.assertTrue(payload["sourceAudioSent"])
        self.assertEqual(payload["ttsProvider"], "google_translate")
        self.assertNotIn("api-hash", encoded)
        self.assertNotIn("session", encoded)
        self.assertNotIn("bot-token", encoded)
        self.assertNotIn("intake prompt", encoded)


if __name__ == "__main__":
    unittest.main()