import tempfile,unittest,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent));import tg_post_agent_formatting_canary as x
class T(unittest.TestCase):
 def test_config_refuses_missing_optin(self):
  old=dict(x.os.environ);x.os.environ.clear();
  with self.assertRaises(x.CanaryError):x.config()
  x.os.environ.clear();x.os.environ.update(old)
 def test_terminal_classifier_accepts_one_recovery_and_rejects_stale_controls(self):
  self.assertEqual(x.classify_terminal(False,False),"recovery")
  self.assertEqual(x.classify_terminal(True,True),"final")
  with self.assertRaises(x.CanaryError):x.classify_terminal(False,True)
 def test_lexical_classifier_accepts_only_decorated_synthetic_draft(self):
  self.assertTrue(x.lexical_preserved("✨ *Synthetic* marker scoped draft."))
  self.assertFalse(x.lexical_preserved("Synthetic marker changed draft."))
 def test_model_fingerprint_allows_new_model_once_and_refuses_same_model_duplicate(self):
  old_ledger, old_env=x.LEDGER,dict(x.os.environ)
  with tempfile.TemporaryDirectory()as d:
   x.LEDGER=Path(d)/"l";x.os.environ["OPENROUTER_FORMATTING_MODEL"]="old";x.reserve("option_1")
   x.os.environ["OPENROUTER_FORMATTING_MODEL"]="new";x.reserve("option_1")
   with self.assertRaises(x.CanaryError):x.reserve("option_1")
   v=json.loads(x.LEDGER.read_text());self.assertEqual(v["attemptedBillableOperations"],17)
  x.LEDGER=old_ledger;x.os.environ.clear();x.os.environ.update(old_env)
 def test_ledger_is_category_only(self):
  old=x.LEDGER
  with tempfile.TemporaryDirectory()as d:
   x.LEDGER=Path(d)/"l";x.os.environ["OPENROUTER_FORMATTING_MODEL"]="test-model";x.reserve("option_1");v=json.loads(x.LEDGER.read_text());self.assertEqual(v["attemptedBillableOperations"],16);self.assertNotIn("Synthetic",json.dumps(v))
  x.LEDGER=old
if __name__=="__main__":unittest.main()
