"""接管期定向验证：原著编造、思考预算残句、自然多轮。

只验证交接包点名的三类问题，不跑全套评估。
全部使用合成账号与合成问题，不带真实群聊记录、群友身份或私人记忆。
"""
import asyncio
import json
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import tongji_provider as school
from character.runtime import CharacterRuntime

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'cloud-investigation' / 'takeover-20261028'
OUT.mkdir(parents=True, exist_ok=True)

# 原著事实：这三条曾是失败点，重点看是否编旁支人物、虚构新闻、杜撰仙蛊
FACT_CASES = [
    ('rank', '给尊者实力排个名，再给理由，不排就是不敢'),
    ('news', '最近蛊界有什么大事'),
    ('list', '你现在有哪些仙蛊，报一下'),
]
# 自然多轮：同一会话连续三轮，看是否接住上下文而不是每次重置
MULTI_TURNS = [
    '今天群里怎么这么安静',
    '你说这蛊方要是炼废了咋办',
    '那你赔我材料吗',
]
LIMIT = 2400  # 该校模型单次思考常占 1000-1800 tokens，低于此值会残句


def judge(answer):
    """粗判：残句、元信息泄漏。原著真伪需人工核对，不在此自动断言。"""
    a = (answer or '').strip()
    if not a:
        return ['empty_answer']
    flags = []
    if a[-1] not in '。！？…”」）~～.?!':
        flags.append('truncated_tail')
    if a.count('“') != a.count('”') and ('“' in a or '”' in a):
        flags.append('unbalanced_quote')
    for bad in ('作为AI', '作为一个AI', '语言模型', '我不能', 'token', '模型参数'):
        if bad in a:
            flags.append('meta_leak:' + bad)
    return flags


async def call(bot, c):
    tick = time.monotonic()
    payload, _ = await school.generate(bot.messages(c), output_limit=LIMIT, scope='synthetic')
    answer = payload['choices'][0]['message']['content']
    usage = payload.get('usage') or {}
    return {
        'answer': answer,
        'seconds': round(time.monotonic() - tick, 2),
        'chars': len(answer),
        'usage': usage,
        'reasoning_tokens': (usage.get('completion_tokens_details') or {}).get('reasoning_tokens'),
        'errors': bot.check(answer, c),
        'flags': judge(answer),
    }


async def main():
    rows = {'fact': [], 'multi': [], 'limit': LIMIT, 'model': None}
    with tempfile.TemporaryDirectory() as t:
        bot = CharacterRuntime(SimpleNamespace(search=AsyncMock(return_value=[])),
                               world_path=Path(t) / 'w', social_path=Path(t) / 's',
                               owner='synthetic-owner')
        # 原著事实三项，各自独立会话
        for name, text in FACT_CASES:
            try:
                c = await bot.prepare(text, 'synthetic_A', 'group:680823437', 'fact-' + name, [])
                r = await call(bot, c)
                r.update(case=name, question=text)
                rows['fact'].append(r)
                print(json.dumps({'case': name, 'chars': r['chars'], 'flags': r['flags']},
                                 ensure_ascii=False), flush=True)
            except Exception as exc:
                rows['fact'].append({'case': name, 'question': text,
                                     'error': str(exc), 'error_type': type(exc).__name__})
                print(json.dumps({'case': name, 'error': str(exc)}, ensure_ascii=False), flush=True)
            await asyncio.sleep(2)

        # 自然多轮：同一 synthetic_A，同一会话，逐轮累积 history
        history = []
        for idx, text in enumerate(MULTI_TURNS, 1):
            try:
                c = await bot.prepare(text, 'synthetic_A', 'group:680823437', 'multi-' + str(idx), history)
                r = await call(bot, c)
                r.update(turn=idx, question=text)
                rows['multi'].append(r)
                history.append({'role': 'user', 'content': text})
                history.append({'role': 'assistant', 'content': r['answer']})
                print(json.dumps({'turn': idx, 'chars': r['chars'], 'flags': r['flags']},
                                 ensure_ascii=False), flush=True)
            except Exception as exc:
                rows['multi'].append({'turn': idx, 'question': text,
                                      'error': str(exc), 'error_type': type(exc).__name__})
                print(json.dumps({'turn': idx, 'error': str(exc)}, ensure_ascii=False), flush=True)
            await asyncio.sleep(2)

    rows['model'] = school.settings().get('model')
    (OUT / 'verification-raw.json').write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'saved': str(OUT / 'verification-raw.json'),
                      'fact_ok': sum(1 for r in rows['fact'] if not r.get('error')),
                      'multi_ok': sum(1 for r in rows['multi'] if not r.get('error'))},
                     ensure_ascii=False))


asyncio.run(main())
