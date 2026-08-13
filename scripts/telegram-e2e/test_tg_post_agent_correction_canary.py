import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import tg_post_agent_correction_canary as canary


def valid_env() -> dict[str, str]:
    return {
        "TG_POST_AGENT_CORRECTION_CANARY_ENABLED": "true",
        "TG_POST_AGENT_REAL_TG_TEST_TARGET_CONFIRMATION": "DEDICATED_TEST_CHAT",
        "TG_POST_AGENT_CORRECTION_CANARY_FIXTURE_CONFIRMATION": "CREATE_AND_DELETE_DEDICATED_SYNTHETIC_FIXTURE_ONLY",
        "TG_POST_AGENT_REAL_TG_API_ID": "12345",
        "TG_POST_AGENT_REAL_TG_API_HASH": "api-hash",
        "TG_POST_AGENT_REAL_TG_STRING_SESSION": "session",
        "TG_POST_AGENT_REAL_TG_BOT_TOKEN": "bot-token",
        "TG_POST_AGENT_REAL_TG_TEST_TARGET_CHAT_ID": "123456",
        "DATABASE_URL": "postgresql:///tg_post_agent?host=/var/run/postgresql",
        "TG_POST_AGENT_CORRECTION_CANARY_TIMEOUT_SECONDS": "60",
        "TG_POST_AGENT_REAL_TG_DUPLICATE_WAIT_SECONDS": "3",
        "TG_POST_AGENT_CORRECTION_CANARY_MAX_SECONDS": "8",
        "TG_POST_AGENT_CORRECTION_CANARY_MAX_BYTES": "524288",
    }


class CorrectionCanaryContractTests(unittest.TestCase):
    def test_requires_explicit_fixture_and_target_guards(self) -> None:
        env = valid_env()
        env["TG_POST_AGENT_CORRECTION_CANARY_ENABLED"] = "false"
        with self.assertRaises(canary.CanaryError):
            canary.parse_config(env)

        env = valid_env()
        env["TG_POST_AGENT_CORRECTION_CANARY_FIXTURE_CONFIRMATION"] = "wrong"
        with self.assertRaises(canary.CanaryError):
            canary.parse_config(env)

    def test_refuses_test_database_and_overlong_audio(self) -> None:
        env = valid_env()
        env["DATABASE_URL"] = "postgresql:///tg_post_agent_test?host=/var/run/postgresql"
        with self.assertRaises(canary.CanaryError):
            canary.parse_config(env)

        env = valid_env()
        env["TG_POST_AGENT_CORRECTION_CANARY_MAX_SECONDS"] = "9"
        with self.assertRaises(canary.CanaryError):
            canary.parse_config(env)

    def test_category_only_ledger_reserves_each_attempt_before_provider_work(self) -> None:
        original = canary.LEDGER_PATH
        with tempfile.TemporaryDirectory() as directory:
            canary.LEDGER_PATH = Path(directory) / "ledger.json"
            canary.reserve("llm_plan_revision_text")
            canary.reserve("external_tts")
            payload = json.loads(canary.LEDGER_PATH.read_text(encoding="utf-8"))
            self.assertEqual(payload["attemptedBillableOperations"], 2)
            self.assertEqual(payload["remainingBudget"], 8)
            self.assertEqual([entry["category"] for entry in payload["entries"]], ["llm_plan_revision_text", "external_tts"])
            self.assertNotIn("session", json.dumps(payload))
        canary.LEDGER_PATH = original


if __name__ == "__main__":
    unittest.main()
