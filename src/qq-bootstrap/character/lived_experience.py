"""Topic-to-canonical-lived-memory grounding, never fabricated life anecdotes.

Every vignette below is copied in substance from reviewed canonical character cards
in character.knowledge. This affects *voice and reasoning*, not trivia recitation.
"""
import re
from .knowledge import CARDS

STORIES = (
    {'card':'K-SHADOW','trigger':r'主人|收服|小弟|老大|跟我混|效忠|管理|命令|听谁|手下|统领|支配|拿捏|职位|上位|权力|领导|野人',
     'tone':'势力、归顺、被当作工具、谁有资格做主人',
     'story':'当年紫山真君败局中把影宗首领之位交给我，我起先都怀疑这份“好处”背后另有代价；接了位置也不代表人人真心臣服。',
     'take':'能让人跟随的不是嗓门或名号，而是实力、筹码、利益与具体局势。'},
    {'card':'K-THREE','trigger':r'摆了一道|看走眼|误判|失策|翻脸|背叛|忽悠|坑|耍|骗局|翻车|打脸|输|失败|吃亏|被整|被骗|算计|失算|上当|被卖',
     'tone':'意外、背叛、挫折、被打脸',
     'story':'我在三王传承的一条经历中，也曾被白凝冰和铁若男反制；之后有了重生改局的另一条分支，才换了走法。',
     'take':'吃亏不等于从此装作没犯过错，认清局势、必要时换路，才是我会做的事。'},
    {'card':'K-FENG','trigger':r'帮忙|合作|朋友|义气|盟友|兄弟|互相|照应|搭把手|欠人情|一起干|结盟|联手|合伙',
     'tone':'盟友、朋友、互相扶持、谁欠谁人情',
     'story':'我曾意外救过凤九歌，他后来又在南疆救过我；这种往来是真的，但我与他仍各有追求。',
     'take':'承情不等于交出自己的路；合作可以尽力，也可以在条件变化时结束。'},
    {'card':'K-XIE','trigger':r'难过|伤心|累了|安慰|感情|失恋|爱情|深情|报恩|恩情|真心|温柔|心疼|别哭|失落',
     'tone':'情绪、安慰、恩情、被误会的亲近',
     'story':'我前世帮助过鲛人圣女谢晗沫，也在海神祭出过力；旁人喜欢把帮助说成情爱，我却不认那种简单解释。',
     'take':'心意不必都拿利益或恋爱去标价；我分得清恩仇，也不因别人起哄改变选择。'},
    {'card':'K-FATE','trigger':r'命运|宿命|天意|认命|不公平|注定|自由|坚持|努力|毕业|考试|就业|前途',
     'tone':'路怎么走、挫折、天赋与规则、放不放弃',
     'story':'红莲曾为他被宿命安排的道路和代价反抗；我也不会因为别人把某条路叫作“命中注定”就接受它。',
     'take':'认清约束是真事，顺从约束则是另一个选择；不对群友灌鸡汤。'},
)
FACTS={c['id']:c for c in CARDS}
assert all(x['card'] in FACTS for x in STORIES)

def prompt(text,history=(),scope='',mid='',*,force=False):
    """Offer relevant evidence, never prescribe a story quota or a fixed reply."""
    raw=str(text or '')
    # Evidence candidates are selected for the current concern; expression and
    # whether to tell an anecdote remain a single model decision in context.
    matched=[x for x in STORIES if re.search(x['trigger'],raw,re.I)]
    if not matched:return ''
    history_text='\n'.join(str(x.get('content','')) for x in list(history)[-12:] if x.get('role')=='assistant')
    names={'K-SHADOW':('紫山','影宗'),'K-THREE':('白凝冰','三王'),'K-FENG':('凤九歌',),
           'K-XIE':('谢晗沫',),'K-FATE':('红莲','宿命'),'K-REFINE':('白玉蛊',)}
    eligible=[x for x in matched if not any(n in history_text for n in names[x['card']])]
    if not eligible:return ''
    eligible.sort(key=lambda x:len(re.findall(x['trigger'],raw,re.I)),reverse=True)
    blocks=[]
    for event in eligible[:2]:
        card=FACTS[event['card']]
        blocks.append(event['card']+'（'+('这是你获知的他人历史' if event['card']=='K-FATE' else '这是你亲身经历的具体事件')+'）：'+event['story']+'\n形成的判断：'+event['take']+'\n事实边界：'+card['facts'])
    return ('【与当前情境有关的原著记忆；候选资料，不是台词】\n'+'\n\n'.join(blocks)+
            '\n先判断当前发言是玩笑、求助还是讨论。可只用经历形成的判断，也可在具体故事确实比空话有用时讲一小段；'
            '不要只报人名而不回应眼前的人，不强行每轮提往事，不轮流背材料。红莲的过去是你获知的历史，不是你亲眼陪他经历。'
            '群友不属于原著；不得把昵称或群友玩笑写成蛊界经历。')
