"""Conversation-level form checks, distinct from string duplication or canon QA."""
import re
KNOWN=('春秋蝉','定仙游','第二空窍蛊','第二空窍仙蛊','白玉蛊','白豕蛊','玉皮蛊','月光蛊','月芒蛊','小光蛊','宿命蛊','爱情蛊','智慧蛊','力量蛊')
def shape(answer):
 return {'recipe':int(bool(re.search(r'主材|材料是|材料[:：]',answer)))+int(bool(re.search(r'辅材|辅以|副作用|反噬|代价是',answer))),
         'question_tail':bool(re.search(r'[?？]\s*$',answer)),
         'intelligence_cost':bool(re.search(r'智商|脑子|脑容量|脑细胞',answer)),
         'fake_experience':bool(re.search(r'这蛊我炼过|我以前炼过|当年我炼过',answer))}
def assess(text,history=()):
 names=re.findall(r'([^\s，。！？?：:]{1,18}蛊)',text)
 named=bool(names and not any(x in text for x in KNOWN))
 factual=bool(re.search(r'原著|真的存在|书里|原文|第几章|正典|真实蛊方',text) and not re.search(r'原创|虚构|不当原著|不是原著|非原著',text))
 hypothetical=bool(named and not factual)
 elaborate=bool(hypothetical and re.search(r'认真|详细|完整|自洽|设计|推演|研究|不是玩笑|展开',text))
 recent=[m['content'] for m in list(history)[-12:] if m.get('role')=='assistant'][-4:]
 previous=[shape(x) for x in recent]
 requests=[m['content'][:120] for m in list(history)[-10:] if m.get('role')=='user' and '蛊' in m['content']][-3:]
 return {'hypothetical':hypothetical,'elaborate':elaborate,'recent_shapes':previous,'requests':requests}
def prompt(state):
 if not state['hypothetical']:return ''
 return ('【当前是未核蛊名的设定或玩笑，非已存在的正典蛊方】\n最近需求：'+str(state['requests'])+
  '\n把当前改口与前几次愿望看成同一段对话；旧助手蛊方只是已说过的内容，不是回答范例。你可以直接吐槽愿望的转变、接当下荒诞前提、作简短炼道判断或展开新设定，自选有用角度，不轮流套固定句式。'
  '没有实证不要说这蛊本人炼过，不把自创蛊或仙元分类冒充原著知识。'
  +('对方明确要认真推演虚构方案，可以展开：目标、约束、失败机制要互相吻合，明确是假设；不用强迫以主材或副作用开头。' if state['elaborate'] else
    '目前只是聊天玩笑，没必要每次交一张说明书。已经说过的材料配方、智商代价和末尾追问不再翻炒。'))
def issues(answer,state):
 if not state.get('hypothetical'):return []
 a=shape(answer);old=state['recent_shapes'];errors=[]
 if a['fake_experience']:errors.append('未核实的自创蛊不能声称本人以前炼过；按当前玩笑或假设设定回答')
 if not state['elaborate']:
  if a['recipe']>=2 and any(x['recipe']>=2 for x in old[-3:]):errors.append('跨轮又用了材料加副作用的同一说明书结构；这次回应连续改需求本身或另一个实际笑点，不替换名词重写蛊方')
  if a['question_tail'] and len(old)>=2 and all(x['question_tail'] for x in old[-2:]):errors.append('连续多次以追问收尾，当前无需向对方索取选择；把本句表达落地就结束')
  if a['intelligence_cost'] and any(x['intelligence_cost'] for x in old[-3:]):errors.append('又拿脑子智商作为同一个代价笑点；回应此刻新意思，不重用这个角度')
 return errors
