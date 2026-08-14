#!/usr/bin/env python3
import asyncio,json,os,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from tg_post_agent_smoke import *
REPORT=Path("/tmp/tg-post-agent-formatting-canary-report.json");LEDGER=Path("/tmp/tg-post-agent-billable-ledger-2026-08-15.json");OPTS=("option_1","option_2")
class CanaryError(RuntimeError):
 def __init__(self,c):self.category=c;super().__init__(c)
def need(n):
 v=os.environ.get(n,"").strip()
 if not v:raise CanaryError("configuration")
 return v
def config():
 if os.environ.get("TG_POST_AGENT_FORMATTING_CANARY_ENABLED","").lower()!="true" or need("TG_POST_AGENT_REAL_TG_TEST_TARGET_CONFIRMATION")!="DEDICATED_TEST_CHAT" or need("TG_POST_AGENT_FORMATTING_CANARY_FIXTURE_CONFIRMATION")!="CREATE_AND_DELETE_DEDICATED_SYNTHETIC_FIXTURE_ONLY":raise CanaryError("configuration")
 o=need("TG_POST_AGENT_FORMATTING_CANARY_OPTION");db=need("DATABASE_URL")
 if o not in OPTS or "tg_post_agent" not in db or "tg_post_agent_test" in db:raise CanaryError("configuration")
 return o
def write(p,x):
 f=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(f,"w")as o:json.dump(x,o,separators=(",",":"),sort_keys=True);o.write("\n")
 os.chmod(p,0o600)
def reserve(o):
 x=json.loads(LEDGER.read_text()) if LEDGER.exists() else {"dailyBudget":30,"attemptedBillableOperations":15,"remainingBudget":15,"entries":[]}
 if x["dailyBudget"]!=30 or x["attemptedBillableOperations"]>=30:raise CanaryError("budget_exhausted")
 attempt = sum(1 for i in x["entries"] if i["category"].startswith("format_"+o))
 category = "format_"+o if attempt == 0 else "format_"+o+"_retry_"+str(attempt)
 if attempt >= 4 or any(i["category"] == category for i in x["entries"]): raise CanaryError("duplicate_option")
 x["attemptedBillableOperations"]+=1;x["remainingBudget"]=30-x["attemptedBillableOperations"];x["entries"].append({"category":category,"billable":True,"outcome":"attempted"});write(LEDGER,x)
def fixture(a,account):
 p=subprocess.run(["node",str(Path(__file__).with_name("formatting_fixture.mjs")),a],env={**os.environ,"TG_POST_AGENT_FORMATTING_CANARY_ACCOUNT_ID":str(account)},capture_output=True)
 if p.returncode:raise CanaryError(a)
def classify_terminal(has_final_controls, has_any_controls):
 if has_final_controls:return "final"
 if not has_any_controls:return "recovery"
 raise CanaryError("stale_controls")
def btn(m,d):
 for r in getattr(getattr(m,"reply_markup",None),"rows",[])or[]:
  for b in getattr(r,"buttons",[])or[]:
   if getattr(b,"data",b"").decode()==d:return b
 raise CanaryError("button_contract")
async def receive(c,b,t,k):
 try:m=await asyncio.wait_for(c.get_response(),t)
 except TimeoutError:raise CanaryError(k)
 if m.sender_id!=b:raise CanaryError("unexpected_sender")
 return m
async def nodup(c,t):
 try:await asyncio.wait_for(c.get_response(),t);raise CanaryError("duplicate_terminal")
 except TimeoutError:pass
async def run(o):
 z={"option":o,"targetConfigured":False,"formatChoiceObserved":False,"formatTerminal":"not_observed","noDuplicate":False,"artifactObserved":False,"fixtureCleaned":False,"providerCallReserved":False,"lastStage":"preflight"};cl=None;account=None
 try:
  from telethon import TelegramClient
  from telethon.sessions import StringSession
  ident=await asyncio.to_thread(fetch_runtime_bot_identity,need("TG_POST_AGENT_REAL_TG_BOT_TOKEN"));cl=TelegramClient(StringSession(need("TG_POST_AGENT_REAL_TG_STRING_SESSION")),int(need("TG_POST_AGENT_REAL_TG_API_ID")),need("TG_POST_AGENT_REAL_TG_API_HASH"),flood_sleep_threshold=0);await cl.connect()
  if not await cl.is_user_authorized():raise UnauthorizedSessionError()
  account=(await cl.get_me()).id;t=await cl.get_entity(ident.username)
  if not getattr(t,"bot",False)or not target_matches_canonical_identity(t.id,ident)or int(need("TG_POST_AGENT_REAL_TG_TEST_TARGET_CHAT_ID"))!=ident.telegram_id:raise CanonicalTargetMismatchError()
  z["targetConfigured"]=True;z["lastStage"]="fixture_create";await asyncio.to_thread(fixture,"create",account)
  async with cl.conversation(t,timeout=60,exclusive=True)as c:
   z["lastStage"]="conversation_anchor";await c.send_message("/start");await receive(c,ident.telegram_id,60,"anchor_timeout");await asyncio.to_thread(fixture,"create",account);z["lastStage"]="fixture_send_draft";await asyncio.to_thread(fixture,"send_draft",account);d=await receive(c,ident.telegram_id,60,"draft_timeout");z["lastStage"]="format_open_click";await d.click(data=btn(d,"format:open").data);z["lastStage"]="format_choice_receive";choice=await receive(c,ident.telegram_id,60,"choice_timeout");choicebtn=btn(choice,"format:"+o);z["formatChoiceObserved"]=True;reserve(o);z["providerCallReserved"]=True;z["lastStage"]="option_click";await choice.click(data=choicebtn.data);await receive(c,ident.telegram_id,60,"format_ack_timeout");final=await receive(c,ident.telegram_id,60,"format_terminal_timeout")
   try:
    done=btn(final,"final:accept");btn(final,"format:edit");terminal=classify_terminal(True, True)
   except CanaryError:
    terminal=classify_terminal(False, bool(getattr(final,"reply_markup",None)))
   z["formatTerminal"]=terminal;await nodup(c,3);z["noDuplicate"]=True
   if terminal == "recovery": raise CanaryError("terminal_recovery")
   await final.click(data=done.data);a=await receive(c,ident.telegram_id,60,"artifact_timeout")
   if not getattr(a,"document",None):raise CanaryError("artifact_missing")
   await nodup(c,3);z["artifactObserved"]=True
  z["status"]="passed";z["failureCategory"]=None
 except BaseException as e:z["status"]="failed";z["failureCategory"]=getattr(e,"category",type(e).__name__)
 finally:
  if account:
   try:await asyncio.to_thread(fixture,"cleanup",account);z["fixtureCleaned"]=True
   except BaseException:pass
  if cl:await cl.disconnect()
 write(REPORT,z);print(json.dumps({"status":z["status"],"failureCategory":z["failureCategory"]}))
if __name__=="__main__":run_result=asyncio.run(run(config()))
