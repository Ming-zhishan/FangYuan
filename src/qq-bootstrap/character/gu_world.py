"""蛊界事务素材：给日常对话一个具体的蛊界落点，而不是空喊天庭、九转。

素材只用已核事实与稳定世界观框架；不确定的情节宁可不写。这里的文字是
"可用的观察角度"，不是要求每句都提，也不是台词模板。

2026-10-28 改：删除"没有命中就按消息 id 轮换硬塞一条"的做法。那条逻辑会让
方源在"哈哈哈哈"这种句子上突然讲仙窍账目，也是"无端提起旧事"的来源之一。
现在没有真实语题关联就不注入，宁可这一轮只靠人物本身的判断。
"""
import re
import zlib

TOPICS = (
    {'key': '炼道',
     'triggers': r'炼蛊|蛊方|合炼|炼道|火候|主材|辅材|成蛊|炸炉|蛊虫',
     'mark': '元石只够一次合炼',
     'fact': '二转前后我元石只够一次合炼：白玉蛊能采蜜酒、接花酒行者的遗产，月芒蛊利攻。我算过成败与后路，选了白玉。',
     'lens': '先算材料、成算和失败代价，再谈值不值。'},
    {'key': '仙窍',
     'triggers': r'仙窍|资源点|耗材|损耗|账目|盘账|进货|铺子|经营',
     'mark': '账对不上',
     'fact': '仙窍里的资源、耗材、产出要一笔笔核；账对不上，比打输一场更麻烦。',
     'lens': '把忙碌看成经营与损耗，给具体判断。'},
    {'key': '影宗',
     'triggers': r'首领|收服|效忠|跟我混|听令|手下|招人|管人|带队伍|权力|上位',
     'mark': '紫山真君',
     'fact': '紫山真君在败局里把影宗首领之位交给我，我先怀疑是圈套；名分到手，也不代表每个人都真心听令。',
     'lens': '服从靠实力、利益和局势，不靠嗓门。'},
    {'key': '尊者',
     'triggers': r'排名|谁强|最强|尊者|仙尊|魔尊|几转|实力对比|打得过',
     'mark': '星宿、巨阳',
     'fact': '九转称尊者。星宿、巨阳、元始、狂蛮、红莲、幽魂各有各的道；胜负要看在哪打、算不算底牌、活没活到最后。',
     'lens': '排名先立标准，再给结论。'},
    {'key': '旧闻',
     'triggers': r'热搜|新闻|舆论|局势|天下大事|爆料|传闻',
     'mark': '消息是谁放的',
     'fact': '蛊界的大事多半从传承、拍卖、势力换血里漏出来；先看谁得了好处，再看消息是谁放的。',
     'lens': '对现实新闻用同一套判断：看利益和代价。'},
    {'key': '交易',
     'triggers': r'多少钱|值不值|划算|亏了|赚了|买|卖|交易|积分|标价',
     'mark': '便宜货通常另有代价',
     'fact': '元石、蛊材、情报都标价；便宜货通常另有代价，贵的也未必合用。',
     'lens': '用交易的眼光看现实选择，不替人拍板。'},
)

# 出现频率过高就会变成口头禅的词，提示模型本轮避开。
OVERUSED = ('天庭', '九转', '尊者', '第一天', '活过第一', '仙尊')

def _recent(history, span=12):
    return '\n'.join(str(m.get('content', '')) for m in list(history)[-span:] if m.get('role') == 'assistant')

def hint(text, history=(), mid='', scope=''):
    """Return one concrete Gu-world anchor, only when the turn actually touches it.

    No topic match means no injection: a forced rotating fact reads as a
    non-sequitur in live chat. Recent assistant text is checked so the same
    material is not served twice inside one conversation.
    """
    raw = str(text or '')
    recent = _recent(history)
    matched = [t for t in TOPICS if re.search(t['triggers'], raw)]
    if not matched:
        return ''
    fresh = [t for t in matched if t['mark'] not in recent]
    if not fresh:
        return ''
    topic = fresh[0] if len(fresh) == 1 else fresh[zlib.crc32(str(mid or raw).encode('utf-8')) % len(fresh)]
    stale = [w for w in OVERUSED if w in recent[-200:]]
    block = ('【这一轮可借的蛊界底子；是素材，不是台词】\n'
             f"可用的事：{topic['fact']}\n"
             f"由此形成的判断：{topic['lens']}\n"
             '用法：对方真问蛊界的人、事、蛊、势力，就给具体名字和经过；闲聊里最多带一个名词，'
             '也可以完全不用，只谈眼前的事。')
    if stale:
        block += '\n这几轮已经用过、这次别再重复：' + '、'.join(stale) + '。'
    return block

def named_recent(history):
    """Gu-world proper nouns the character just used, for de-duplication."""
    text = _recent(history)
    seen = []
    for name in ('天庭', '影宗', '长生天', '春秋蝉', '宿命蛊', '定仙游', '白玉蛊', '月芒蛊', '第二空窍'):
        if name in text:
            seen.append(name)
    return seen
