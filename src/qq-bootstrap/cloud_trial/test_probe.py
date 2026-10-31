import asyncio,json,tempfile,time,unittest
from pathlib import Path
import httpx
from probe import Ledger,Blocked,authorize,bounded_request,invoke,MODELS

class CostControls(unittest.IsolatedAsyncioTestCase):
 async def test_missing_or_identity_only_approval_never_sends_request(self):
  with tempfile.TemporaryDirectory() as folder:
   receipt=Path(folder)/'approval.json';ledger=Ledger(Path(folder)/'ledger.db');seen=[]
   async def handler(request):seen.append(request);return httpx.Response(200,json={})
   async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
    with self.assertRaises(Blocked):await invoke(client,ledger,'qwen3.8-flash',[{'role':'user','content':'你好'}],41,receipt,'fake-secret')
   self.assertEqual(seen,[]);self.assertEqual(ledger.summary(),(0,0))
 def test_two_ledger_instances_cannot_overspend_or_reset_budget(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/'ledger.db';a,b=Ledger(p),Ledger(p)
   count=0
   while True:
    try:(a if count%2 else b).reserve('qwen3.8-2.4t-a95b',6000);count+=1
    except Blocked:break
   self.assertGreater(count,0);self.assertLessEqual(a.summary()[1],4_500_000)
   self.assertEqual(a.summary(),b.summary())
 async def test_http_failure_keeps_reservation_and_does_not_retry_or_leak_key(self):
  with tempfile.TemporaryDirectory() as folder:
   receipt=Path(folder)/'approval.json';receipt.write_text(json.dumps(dict(user_authorized_free_only_trial=True,free_tier_only_verified={m:True for m in MODELS},cash_spend_authorized_cny=0,region='cn-beijing',expires_unix=time.time()+60,max_calls=72,gross_cost_cap_cny=4.5)))
   ledger=Ledger(Path(folder)/'ledger.db');seen=[]
   async def handler(request):seen.append(request);return httpx.Response(429,text='secret=FAKE-DO-NOT-LOG')
   async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
    result=await invoke(client,ledger,'qwen3.8-flash',[{'role':'user','content':'你好'}],41,receipt,'FAKE-DO-NOT-LOG')
   self.assertEqual(len(seen),1);self.assertFalse(result['ok']);self.assertGreater(ledger.summary()[1],0)
   self.assertNotIn('FAKE-DO-NOT-LOG',json.dumps(result))
 def test_unapproved_model_or_excess_input_stops_without_truncating_evidence(self):
  with self.assertRaises(Blocked):bounded_request('qwen3.8-flash',[{'role':'user','content':'原文'*5000}],41)
  with tempfile.TemporaryDirectory() as folder:
   with self.assertRaises(Blocked):Ledger(Path(folder)/'l.db').reserve('qwen3.8-max',1)

if __name__=='__main__':unittest.main()
