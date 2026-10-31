"""Small sourced culture cache. Canon, fan work and group inventions stay distinct."""
import re
import json
from pathlib import Path
from datetime import date
SEMANTICS=json.loads(Path(__file__).with_name('network_semantics.json').read_text(encoding='utf-8'))

def semantic_notes(text,history=(),scope=''):
 """Bounded, sourced senses; recent context may override a familiar pun."""
 nearby='\n'.join(str(m.get('content','')) for m in list(history)[-4:])
 notes=[]
 for item in SEMANTICS:
  if item['scope'] not in ('*',scope) or not any(term in text for term in item['terms']):continue
  # Stale public usage is not a permanent definition of a changing meme.
  if item['confidence']!='group-confirmed' and (date.today()-date.fromisoformat(item['verified_at'])).days>90:continue
  literal=bool(re.search(item['literal_cues'],text) or re.search(item['literal_cues'],nearby))
  notes.append('【语义资料；不是台词】'+(item['literal_note'] if literal else item['meaning'])+
               ' 来源：'+item['source']+'；核对：'+item['verified_at']+'；可信范围：'+item['confidence'])
 return notes[:2]
ROSTER_FILE=Path(__file__).resolve().parents[2]/'private/group-roster.json'
# Fallback only if the reviewed roster file is missing; it mirrors the same five
# people. Real names are authoritative, nicknames are for recognition only.
_FALLBACK=[('2602295827','沈烨','21'),('2807839774','成飞扬','君莫笑'),
           ('2171196385','黄梓涵','戒不掉多巴胺'),('932314136','陈俊耀','耀'),
           ('2449113325','谢梓尧','青盲哑狗')]
def _members():
 try:
  data=json.loads(ROSTER_FILE.read_text(encoding='utf-8'))
  rows=[(str(m['qq']),str(m['name']),str(m.get('nickname') or '')) for m in data['members']]
  return rows or _FALLBACK
 except Exception:return _FALLBACK
MEMBERS=_members()
FRIENDS={qq:[name]+([nick] if len(nick)>=2 and not nick.isdigit() else []) for qq,name,nick in MEMBERS}
NICKNAMES={qq:nick for qq,name,nick in MEMBERS}
NAMES={qq:name for qq,name,_ in MEMBERS}
SOURCES={
 'theories':'https://www.douyin.com/video/7694160989498920192',
 'practice':'https://www.douyin.com/video/7693893744470726479',
 'fan':'https://www.bilibili.com/video/BV1KK421y72q/'}
def context(text,history=(),scope=''):
 notes=semantic_notes(text,history,scope)
 if re.search(r'薄肌|大水|大睡|黄毛|不烧心|.{1,6}理论',text):
  notes.append('短视频“理论”常把生活习惯或态度包装成学派，可能是在串梗。薄肌通常围绕低体脂线条，大水围绕喝水，大睡围绕睡觉；黄毛可能借不端着、敢行动的刻板形象反讽。这里只核过实际用法，没有核过统一核心定义、必备资格或最早起源；不同圈子的黄毛用法也不能直接等同。不是科学定律，也不自动等于蛊界流派。其他新理论依本句推断，不编流行起源。可顺着荒诞前提走一步，说完即止。')
 if re.search(r'91|jj|变大蛊|穷学生|穷蛊师',text,re.I):
  notes.append('这可能是数字暗语、性暗示或反串套话；91在成人玩笑语境可能指成人内容，普通编号语境仍按编号理解。理解双关，不装糊涂、不训诫、不把玩笑当真实蛊方或医学请求。穷学生式自述也可能是反串，不直接写入身份事实。')
 if re.search(r'落魄谷中寒风吹|春秋蝉鸣少年归|二创|同人诗|读者.*诗',text):
  notes.append('【二创资料，非原著事实】用户提供且公开视频标题可交叉定位的一组流传配诗是“落魄谷中寒风吹，春秋蝉鸣少年归”。如果上句是前半句，可接后半句。原作者及更长版本未核实，不自行补全整首或声称是本人写的原著诗。落魄谷、春秋蝉等借用了书中意象，但诗句本身不证明这些情节以该顺序发生。其他填词、同人片段需要明确出处，不按正典讲。')
 for work in FAN_INDEX:
  if work['title'] in text:notes.append('二创索引：'+str(work))
 return '\n'.join(notes[:2])
def roster():
 lines=[f'{name}（群昵称{nick or "无"}，QQ {qq}）' for qq,name,nick in MEMBERS]
 return ('【群成员实名表；2026-10-28 与群成员接口逐条核对】'+'；'.join(lines)+
         '。称呼一律用真名，群昵称只用于认人。说话的人是谁由账号决定：不要把甲的话安到乙头上，'
         '不要把群友认成原著人物，也不要在回答里对错人使用称呼。五人都可以自然互损；没有额外管理权限，不预设谁性格如何。')
def who(uid):
 uid=str(uid)
 for qq,name,nick in MEMBERS:
  if qq==uid:return name+(f'（群昵称{nick}）' if nick else '')
 return ''

FAN_INDEX=[
 {'title':'千本蛊','kind':'fan-song','creator':'玖琉の世界','url':'https://www.bilibili.com/video/BV1S3VKzjEKG/','note':'以千本樱为底的蛊真人填词；仅确认作品元数据，不背未核歌词。'},
 {'title':'纵此生','kind':'fan-song','url':'https://www.bilibili.com/video/BV14B6GBjEPw/','note':'围绕红莲魔尊的读者填词；歌曲演绎不等于原著事实。'},
 {'title':'在蛊界怎么能不会吟诗呢','kind':'fan-video','url':'https://www.bilibili.com/video/BV1vYGt6qEX7/','note':'读者诗词视频索引；未逐句核阅，不凭标题补全诗句。'}]
