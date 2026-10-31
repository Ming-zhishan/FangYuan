"""User-run, read-only check that also works while this chat is disconnected."""
import argparse,asyncio,datetime,json,sys,time
from pathlib import Path
import tongji_provider as school

LABELS={
 'school_network_policy_denied':'学校仍拒绝当前网络环境（403）。',
 'school_authentication_failed':'学校返回鉴权失败（401）；网络已能收到该鉴权结果。',
 'school_model_permission_denied':'学校返回模型权限不足。',
 'school_quota_exhausted':'学校返回积分或额度不足。',
 'school_forbidden':'学校拒绝访问（403），当前返回值没有明确原因。',
 'school_rate_limited':'学校返回限流，请勿反复运行。',
 'school_reasoning_exhausted':'学校模型思考占满了输出上限，未留下正文；需要提高输出上限后重试。',
 'new_key_rotation_required':'本机密钥确认记录缺失；不要把密钥发到聊天中。',
 'new_key_missing':'没有找到可用的本机受保护密钥。',
}

async def check():
 tick=time.monotonic()
 out={'checked_at':datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),
      'endpoint':school.BASE+'/models','operation':'GET models only',
      'inference_requests':0,'network_settings_changed':False,'key_displayed':False}
 try:
  models=await asyncio.wait_for(school.models(),timeout=12)
  out.update(result='model_list_accessible',http_status=200,
             target_model_listed=any(x.get('id')=='DeepSeek-V4.1-Flash' for x in models),
             summary='成功读取授权模型列表（HTTP 200）。这还不代表聊天生成、积分及使用规则已验证。')
 except school.Blocked as error:
  out.update(result=error.code,summary=LABELS.get(error.code,'本次连接未成功，原因代码：'+error.code))
 except TimeoutError:out.update(result='overall_timeout',summary='12秒内未完成连接检查，可能是网络或DNS问题。')
 except Exception as error:out.update(result=type(error).__name__,summary='本机检查未能完成，错误类型：'+type(error).__name__)
 out['seconds']=round(time.monotonic()-tick,3)
 return out

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
 out=asyncio.run(check());folder=args.output.resolve();folder.mkdir(parents=True,exist_ok=True)
 (folder/'关TUN后检查结果.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
 text=('检测时间：'+out['checked_at']+'\n\n'+out['summary']+'\n\n'
       '结果代码：'+out['result']+'\n耗时：'+str(out['seconds'])+'秒\n\n'
       '检查已结束，现在可以重新打开M78的TUN，再回到聊天。\n'
       '将“结果代码”告诉助手即可，不需要提供任何密钥。\n'
       '本工具只读取模型列表，不调用聊天生成、不充值、不修改代理或机器人配置。\n')
 (folder/'关TUN后检查结果.txt').write_text(text,encoding='utf-8-sig')
 if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
 print(text)
 return 0

if __name__=='__main__':
 try:sys.exit(main())
 except Exception as error:
  print('检查未能保存结果，错误类型：'+type(error).__name__)
  sys.exit(1)
