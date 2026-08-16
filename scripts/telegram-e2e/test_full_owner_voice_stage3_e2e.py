import datetime as dt
import json, sys, tempfile, unittest
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import full_owner_voice_stage3_e2e as x
import asyncio


class B:
    def __init__(self, data): self.data = data.encode()
class R:
    def __init__(self, data): self.buttons = [B(data)]
class M:
    def __init__(self, id, data, sender=1):
        self.id = id
        self.sender_id = sender
        self.reply_markup = type('K', (), {'rows': [R(data)]})()

class Media:
    def __init__(self, message_id, sender, age_seconds, kind):
        self.id = message_id
        self.sender_id = sender
        self.date = dt.datetime.fromtimestamp(1_000 - age_seconds, tz=dt.timezone.utc)
        self.voice = object() if kind == 'voice' else None
        self.audio = object() if kind == 'audio' else None

class SourceClient:
    def __init__(self, messages): self.messages = messages
    async def get_messages(self, target, limit): return self.messages
    async def download_media(self, message, file): Path(file).write_bytes(b'x')


class T(unittest.TestCase):
    def test_matched_scope_continues(self): self.assertTrue(x.scope_is_eligible({'found': True, 'recipient': '7'}, 7))
    def test_mismatch_aborts_before_write(self): self.assertFalse(x.scope_is_eligible({'found': True, 'recipient': '8'}, 7))
    def test_missing_scope_aborts(self): self.assertFalse(x.scope_is_eligible({'found': False}, 7))
    def test_cursor_ignores_old_plan_and_sees_new(self): self.assertEqual(x.newer_callback_prefixes([M(1, 'plan:old'), M(3, 'plan:new')], 2), ['plan'])
    def test_scope_poll_finds_delayed_project(self):
        seen = []
        def fetch(a, c):
            seen.append(1)
            return {'found': len(seen) > 1, 'recipient': '7'}
        self.assertTrue(asyncio.run(x.wait_for_scope(fetch, 7, 1, deadline=1, interval=0)).get('found'))
    def test_one_attempt_overlay_bounds_four_stages_without_mutating_normal_config(self):
        normal = {'PROVIDER_FALLBACKS_ENABLED': 'true', 'DRAFT_GENERATION_JOB_MAX_ATTEMPTS': '3'}
        overlay = x.overlay_environment(normal)
        report = x.e2e_preflight({'dailyBudget': 30, 'attemptedBillableOperations': 26, 'remainingBudget': 4}, overlay)
        self.assertTrue(report['canProceed'])
        self.assertEqual(report['externalCallBound'], 4)
        self.assertEqual(normal, {'PROVIDER_FALLBACKS_ENABLED': 'true', 'DRAFT_GENERATION_JOB_MAX_ATTEMPTS': '3'})
    def test_missing_overlay_refuses_before_telegram_or_provider_actions(self):
        report = x.e2e_preflight({'dailyBudget': 30, 'attemptedBillableOperations': 26, 'remainingBudget': 4}, {})
        self.assertFalse(report['canProceed'])
        self.assertEqual(report['category'], 'one_attempt_overlay_missing')
        self.assertIsNone(report['externalCallBound'])
    def test_scope_helper_refuses_root_before_db_access(self):
        with mock.patch.object(x.os, 'geteuid', return_value=0):
            with self.assertRaises(x.CanaryError) as raised:
                x.persisted_scope(7, 1.0)
        self.assertEqual(raised.exception.category, 'scope_helper_runtime_user_required')
    def test_runner_keeps_db_scope_and_harness_under_runtime_user(self):
        runner = (Path(__file__).parent / 'full_owner_voice_stage3_e2e_overlay_runner.sh').read_text(encoding='utf-8')
        self.assertIn('scope-preflight)', runner)
        self.assertGreaterEqual(runner.count('su -s /bin/bash "$runtime_user"'), 2)
        self.assertIn("bash scripts/telegram-e2e/full_owner_voice_stage3_e2e.sh run", runner)
    def test_runner_prepares_shorttalk_owned_ledger_and_unique_report_path(self):
        runner = (Path(__file__).parent / 'full_owner_voice_stage3_e2e_overlay_runner.sh').read_text(encoding='utf-8')
        self.assertIn('chown "$runtime_user":"$runtime_user" "$ledger_path"', runner)
        self.assertIn('install -d -o "$runtime_user" -g "$runtime_user" -m 700 "$report_dir"', runner)
        self.assertIn('TG_POST_AGENT_FULL_E2E_REPORT=', runner)
        self.assertIn('source-preflight)', runner)
    def test_preflight_refuses_missing_audio_copy_before_telegram_actions(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger_path = Path(directory) / 'ledger.json'
            ledger_path.write_text(json.dumps({'dailyBudget': 40, 'attemptedBillableOperations': 28, 'remainingBudget': 12}), encoding='utf-8')
            environment = dict(x.E2E_ONE_ATTEMPT_OVERLAY)
            environment['TG_POST_AGENT_FULL_E2E_LEDGER_PATH'] = str(ledger_path)
            environment['TG_POST_AGENT_OWNER_AUDIO_COPY'] = str(Path(directory) / 'missing-audio-copy')
            report = x.e2e_preflight_from_environment(environment)
        self.assertFalse(report['canProceed'])
        self.assertEqual(report['category'], 'source_audio_copy_unavailable')
        self.assertEqual(report['externalCallBound'], 4)
    def test_source_recovery_selects_latest_recent_owner_audio_only(self):
        messages = [
            Media(9, 7, 1, 'document'),
            Media(10, 8, 1, 'audio'),
            Media(11, 7, 31 * 24 * 60 * 60, 'voice'),
            Media(12, 7, 2, 'voice'),
            Media(13, 7, 1, 'audio'),
        ]
        self.assertIs(x.select_recent_owner_media(messages, 7, 1_000), messages[-1])
    def test_source_recovery_ignores_bot_document_and_non_media(self):
        messages = [Media(1, 8, 1, 'audio'), Media(2, 7, 1, 'document')]
        self.assertIsNone(x.select_recent_owner_media(messages, 7, 1_000))
    def test_source_recovery_source_unavailable_cleans_existing_temp_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / 'audio.mp3'
            audio.write_bytes(b'stale')
            with self.assertRaises(x.CanaryError) as raised:
                asyncio.run(x.recover_owner_audio(SourceClient([]), object(), 7, audio, now=lambda: 1_000))
            self.assertEqual(raised.exception.category, 'source_unavailable')
            self.assertFalse(audio.exists())
    def test_source_recovery_download_is_validated_and_cleanup_is_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / 'audio.mp3'
            media = Media(3, 7, 1, 'audio')
            self.assertEqual(asyncio.run(x.recover_owner_audio(SourceClient([media]), object(), 7, audio, now=lambda: 1_000)), 'audio')
            self.assertTrue(x.audio_copy_ready(audio))
            self.assertTrue(x.cleanup_audio_copy(audio))
            self.assertFalse(audio.exists())
    def test_stale_format_callback_cannot_progress_without_current_draft_enqueue(self):
        self.assertFalse(x.scope_has_expected_enqueue({'found': True, 'expectedJobEnqueued': False}))
    def test_current_project_draft_enqueue_allows_progress(self):
        self.assertTrue(x.scope_has_expected_enqueue({'found': True, 'expectedJobEnqueued': True}))
    def test_enqueue_poll_waits_for_current_project_job_not_any_callback(self):
        seen = []
        def fetch(account, started, job_type):
            seen.append(job_type)
            return {'found': True, 'expectedJobEnqueued': len(seen) > 1}
        result = asyncio.run(x.wait_for_expected_enqueue(fetch, 7, 1, 'GENERATE_DRAFT', deadline=1, interval=0))
        self.assertTrue(x.scope_has_expected_enqueue(result))
        self.assertEqual(seen, ['GENERATE_DRAFT', 'GENERATE_DRAFT'])
    def test_missing_current_format_enqueue_fails_closed(self):
        result = asyncio.run(x.wait_for_expected_enqueue(lambda a, s, j: {'found': True, 'expectedJobEnqueued': False}, 7, 1, 'FORMAT_POST', deadline=0, interval=0))
        self.assertFalse(x.scope_has_expected_enqueue(result))
    def test_scope_poll_deadline_returns_absent(self): self.assertFalse(asyncio.run(x.wait_for_scope(lambda a, c: {'found': False}, 7, 1, deadline=0, interval=0)).get('found'))
    def test_selector_uses_user_and_run_start_not_source_message(self):
        rows = [{'user': 7, 'created': 4}, {'user': 8, 'created': 9}, {'user': 7, 'created': 6}]
        self.assertEqual(x.select_scope(rows, 7, 5)['created'], 6)
    def test_selector_absent_fails_closed(self): self.assertIsNone(x.select_scope([{'user': 8, 'created': 9}], 7, 5))
    def test_pre_start_boundary_selects_project_created_by_start(self):
        rows = [{'user': 7, 'created': 4}, {'user': 7, 'created': 5}, {'user': 8, 'created': 6}]
        self.assertEqual(x.select_scope(rows, 7, 4)['created'], 5)
    def test_source_audio_send_is_not_voice_or_document_for_mp3_copy(self): self.assertEqual(x.source_audio_send_kwargs(), {'voice_note': False, 'force_document': False})
    def test_duplicate_classifier_ignores_stale_and_progress(self): self.assertFalse(x.has_new_final_callback([M(1, 'final:accept'), M(3, 'format:open')], 1, 2))
    def test_duplicate_classifier_detects_new_final(self): self.assertTrue(x.has_new_final_callback([M(3, 'final:accept')], 1, 2))
    def test_version_scoped_delivery_ignores_stale_final_and_counts_one_current_txt(self):
        messages = [M(1, 'final:accept'), M(5, 'final:accept')]
        messages.append(type('D', (), {'id': 7, 'sender_id': 1, 'document': object(), 'reply_markup': None})())
        evidence = x.version_scoped_delivery_evidence(messages, bot_id=1, format_cursor=3, export_cursor=5)
        self.assertEqual(evidence, {'currentFinalCount': 1, 'currentTxtCount': 1, 'noDuplicateFinal': True, 'txtArtifactObserved': True})
    def test_version_scoped_delivery_rejects_duplicate_current_final(self):
        evidence = x.version_scoped_delivery_evidence([M(5, 'final:accept'), M(6, 'final:accept')], bot_id=1, format_cursor=3, export_cursor=6)
        self.assertFalse(evidence['noDuplicateFinal'])
        self.assertEqual(evidence['currentFinalCount'], 2)


if __name__ == '__main__': unittest.main()
