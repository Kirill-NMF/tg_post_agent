import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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
    def test_requires_explicit_guards_and_voice_only_mode(self) -> None:
        env = valid_env()
        env["TG_POST_AGENT_CORRECTION_CANARY_ENABLED"] = "false"
        with self.assertRaises(canary.CanaryError):
            canary.parse_config(env)

        env = valid_env()
        env["TG_POST_AGENT_CORRECTION_CANARY_MODE"] = "voice_only"
        self.assertEqual(canary.parse_config(env).mode, "voice_only")

        env["TG_POST_AGENT_CORRECTION_CANARY_MODE"] = "unknown"
        with self.assertRaises(canary.CanaryError):
            canary.parse_config(env)

    def test_local_failure_is_classified_without_ledger_consumption(self) -> None:
        original = canary.LEDGER_PATH
        with tempfile.TemporaryDirectory() as directory:
            canary.LEDGER_PATH = Path(directory) / "ledger.json"
            with self.assertRaises(canary.CanaryError) as raised:
                canary.run_local_stage("ffmpeg_conversion", lambda: (_ for _ in ()).throw(OSError()))
            self.assertEqual(raised.exception.category, "ffmpeg_conversion")
            self.assertFalse(canary.LEDGER_PATH.exists())
        canary.LEDGER_PATH = original

    def test_refuses_test_database_and_unbounded_audio(self) -> None:
        env = valid_env()
        env["DATABASE_URL"] = "postgresql:///tg_post_agent_test?host=/var/run/postgresql"
        with self.assertRaises(canary.CanaryError):
            canary.parse_config(env)

        env = valid_env()
        env["TG_POST_AGENT_CORRECTION_CANARY_MAX_SECONDS"] = "9"
        with self.assertRaises(canary.CanaryError):
            canary.parse_config(env)

    def test_records_billable_and_transport_boundaries_one_by_one(self) -> None:
        original = canary.LEDGER_PATH
        with tempfile.TemporaryDirectory() as directory:
            canary.LEDGER_PATH = Path(directory) / "ledger.json"
            started = 1.0
            canary.reserve_billable("external_tts", "google_translate", started)
            canary.record_transport("telegram_upload", started)
            canary.reserve_billable("stt_edit_transcription", "openrouter", started)
            payload = json.loads(canary.LEDGER_PATH.read_text(encoding="utf-8"))
            self.assertEqual(payload["attemptedBillableOperations"], 2)
            self.assertEqual(payload["remainingBudget"], 8)
            self.assertEqual(
                [(entry["category"], entry["billable"]) for entry in payload["entries"]],
                [("external_tts", True), ("telegram_upload", False), ("stt_edit_transcription", True)],
            )
            self.assertNotIn("bot-token", json.dumps(payload))
        canary.LEDGER_PATH = original

    def test_post_upload_receive_exception_keeps_precise_ack_category_and_actual_ledger(self) -> None:
        observations, error, ledger, checkpoint = self.run_voice_with_responses([RuntimeError("transport")])

        self.assertEqual(error.category, "ack_timeout")
        self.assertTrue(observations["telegramUploadAttempted"])
        self.assertTrue(observations["localAudioCleaned"])
        self.assertEqual(ledger["attemptedBillableOperations"], 2)
        self.assertTrue(checkpoint["telegramUploadAttempted"])
        self.assertTrue(checkpoint["localAudioCleaned"])

    def test_post_ack_status_exception_is_harness_runtime_without_revision_ledger_entry(self) -> None:
        acknowledgement = FakeMessage(42, canary.VOICE_ACK_MARKER)
        with patch.object(canary, "revision_job_status", side_effect=RuntimeError("local test")):
            observations, error, ledger, checkpoint = self.run_voice_with_responses([acknowledgement])

        self.assertEqual(canary.category(error), "harness_runtime")
        self.assertTrue(observations["editAcknowledgementObserved"])
        self.assertTrue(observations["localAudioCleaned"])
        self.assertEqual(ledger["attemptedBillableOperations"], 2)
        self.assertEqual(checkpoint["lastStage"], "ack_timeout")

    def test_lifecycle_snapshot_contains_only_status_and_notification_booleans(self) -> None:
        original = canary.LIFECYCLE_PATH
        with tempfile.TemporaryDirectory() as directory:
            canary.LIFECYCLE_PATH = Path(directory) / "lifecycle.json"
            canary.write_lifecycle(
                {"edit": "succeeded", "revision": "running", "revisionStarted": True},
                {"notificationObservation": "not_observed"},
            )
            payload = json.loads(canary.LIFECYCLE_PATH.read_text(encoding="utf-8"))
            self.assertEqual(payload, {"editJob": "succeeded", "revisionJob": "running", "revisionStarted": True, "notificationObserved": False})
        canary.LIFECYCLE_PATH = original

    def test_accepts_an_explicit_owner_approved_fifteen_operation_ledger(self) -> None:
        original = canary.LEDGER_PATH
        with tempfile.TemporaryDirectory() as directory:
            canary.LEDGER_PATH = Path(directory) / "ledger.json"
            canary.write_json(canary.LEDGER_PATH, {"dailyBudget": 15, "attemptedBillableOperations": 8, "remainingBudget": 7, "entries": []})
            self.assertEqual(canary.read_ledger()["remainingBudget"], 7)
        canary.LEDGER_PATH = original

    def test_history_observer_matches_only_new_bot_marker(self) -> None:
        message = asyncio.run(
            canary.history_message(
                FakeClient([], [FakeMessage(42, canary.VOICE_ACK_MARKER)]),
                object(),
                42,
                100,
                (canary.VOICE_ACK_MARKER,),
            )
        )
        self.assertIsNotNone(message)

    def test_duplicate_observer_classifies_one_duplicate_or_unavailable_without_storing_text(self) -> None:
        single = asyncio.run(
            canary.observe_terminal_delivery(
                FakeClient([], [FakeMessage(42, canary.PLAN_MARKER)]), object(), 42, 100, 0.01
            )
        )
        duplicate = asyncio.run(
            canary.observe_terminal_delivery(
                FakeClient([], [FakeMessage(42, canary.PLAN_MARKER), FakeMessage(42, canary.SAFE_ERROR_MARKER)]), object(), 42, 100, 0.01
            )
        )
        unavailable = asyncio.run(canary.observe_terminal_delivery(FailingHistoryClient(), object(), 42, 100, 0.01))

        self.assertEqual(single, "single_observed")
        self.assertEqual(duplicate, "duplicate_observed")
        self.assertEqual(unavailable, "observation_unavailable")

    def run_voice_with_responses(self, responses):
        original_ledger = canary.LEDGER_PATH
        original_checkpoint = canary.CHECKPOINT_PATH
        with tempfile.TemporaryDirectory() as directory:
            canary.LEDGER_PATH = Path(directory) / "ledger.json"
            canary.CHECKPOINT_PATH = Path(directory) / "checkpoint.json"
            observations = {"localAudioCleaned": False, "telegramUploadAttempted": False, "editAcknowledgementObserved": False, "lastStage": "not_started"}
            config = canary.Config(1, "hash", "session", "token", "postgresql:///tg_post_agent", 42, 0.01, 1, 8, 1024, "voice_only")
            client = FakeClient(responses)
            with patch.object(canary, "generate_tts", side_effect=lambda path: path.write_bytes(b"audio")), patch.object(canary, "convert_voice", side_effect=lambda _source, target, _seconds: target.write_bytes(b"ogg")), patch.object(canary, "validate_audio", return_value=None):
                with self.assertRaises(BaseException) as raised:
                    asyncio.run(canary.run_voice_correction(client, object(), 42, config, 1.0, observations))
            ledger = json.loads(canary.LEDGER_PATH.read_text(encoding="utf-8"))
            checkpoint = json.loads(canary.CHECKPOINT_PATH.read_text(encoding="utf-8"))
        canary.LEDGER_PATH = original_ledger
        canary.CHECKPOINT_PATH = original_checkpoint
        return observations, raised.exception, ledger, checkpoint


class FakeMessage:
    def __init__(self, sender_id: int, raw_text: str):
        self.sender_id = sender_id
        self.raw_text = raw_text


class FakeConversation:
    def __init__(self, responses):
        self.responses = iter(responses)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get_response(self):
        value = next(self.responses)
        if isinstance(value, BaseException):
            raise value
        return value


class FakeClient:
    def __init__(self, responses, history_responses=()):
        self.responses = responses
        self.history_responses = history_responses

    def conversation(self, *_args, **_kwargs):
        return FakeConversation(self.responses)

    async def send_file(self, *_args, **_kwargs):
        return FakeSentMessage()

    async def iter_messages(self, *_args, **_kwargs):
        for message in self.history_responses:
            yield message


class FakeSentMessage:
    id = 100


class FailingHistoryClient(FakeClient):
    def __init__(self):
        super().__init__([])

    async def iter_messages(self, *_args, **_kwargs):
        raise RuntimeError("offline test")
        yield None


if __name__ == "__main__":
    unittest.main()
