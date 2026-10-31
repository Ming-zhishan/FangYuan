import asyncio,io,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import AsyncMock,patch
from contextlib import redirect_stdout
import status
class MessageSocketStatus(unittest.TestCase):
 def check(self,correct):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);(root/'work/private').mkdir(parents=True);(root/'work/private/cloud-runtime.json').write_text('{"mode":"cloud"}')
   live={'online':True,'correct_account':correct,'in_target_group':True,'qq':'3816636861' if correct else 'wrong'}
   output=io.StringIO()
   with patch.object(status,'ROOT',root),patch.object(status,'onebot_readonly',AsyncMock(return_value=live)),patch.object(status,'napcat_client') as web,patch.object(sys,'argv',['status.py','--require-login']),redirect_stdout(output):
    code=status.main();web.assert_not_called()
   self.assertEqual(code,0 if correct else 2);self.assertEqual(json.loads(output.getvalue())['qq_logged_in'],correct)
 def test_online_bot_does_not_use_unrelated_web_login(self):self.check(True)
 def test_wrong_online_account_is_never_accepted(self):self.check(False)
if __name__=='__main__':unittest.main()
