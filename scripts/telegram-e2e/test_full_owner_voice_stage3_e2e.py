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


if __name__ == '__main__': unittest.main()
