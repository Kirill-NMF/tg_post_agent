import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import full_owner_voice_stage3_e2e as x
import asyncio

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
 def test_scope_poll_finds_delayed_project(self):
  seen=[]
  def fetch(a,c): seen.append(1); return {'found':len(seen)>1,'recipient':'7'}
  self.assertTrue(asyncio.run(x.wait_for_scope(fetch,7,1,deadline=1,interval=0)).get('found'))
 def test_scope_poll_deadline_returns_absent(self):
  self.assertFalse(asyncio.run(x.wait_for_scope(lambda a,c:{'found':False},7,1,deadline=0,interval=0)).get('found'))
 def test_selector_uses_user_and_run_start_not_source_message(self):
  rows=[{'user':7,'created':4},{'user':8,'created':9},{'user':7,'created':6}]
  self.assertEqual(x.select_scope(rows,7,5)['created'],6)
 def test_selector_absent_fails_closed(self): self.assertIsNone(x.select_scope([{'user':8,'created':9}],7,5))
if __name__=='__main__': unittest.main()
