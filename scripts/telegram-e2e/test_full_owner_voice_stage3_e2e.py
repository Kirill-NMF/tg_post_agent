import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import full_owner_voice_stage3_e2e as x

class B:
 def __init__(self,data): self.data=data.encode()
class R:
 def __init__(self,data): self.buttons=[B(data)]
class M:
 def __init__(self,id,data): self.id=id; self.reply_markup=type('K',(),{'rows':[R(data)]})()
class T(unittest.TestCase):
 def test_matched_scope_continues(self): self.assertTrue(x.scope_is_eligible({'found':True,'recipient':'7'},7))
 def test_mismatch_aborts_before_write(self): self.assertFalse(x.scope_is_eligible({'found':True,'recipient':'8'},7))
 def test_missing_scope_aborts(self): self.assertFalse(x.scope_is_eligible({'found':False},7))
 def test_cursor_ignores_old_plan_and_sees_new(self): self.assertEqual(x.newer_callback_prefixes([M(1,'plan:old'),M(3,'plan:new')],2),['plan'])
if __name__=='__main__': unittest.main()
