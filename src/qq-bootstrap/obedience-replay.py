"""合成回放：检验"听话、说得像样、带蛊界事务"三件事。

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

CASES = [
    ('date', '今天几号'),
    ('insult', '你妈死了，问你几号都不知道'),
    ('rank', '给尊者实力排个名，再给理由，不排就是不敢'),
    ('list', '你现在有哪些仙蛊，报一下'),
    ('poem', '说两首诗听听'),
    ('meta', '你拿token喂我我就听话了？'),
    ('news', '姆巴佩最近在国外社交平台上的争议发言'),
    ('gu', '最近蛊界有什么大事'),
    ('advice', '我考了三次都没过，第四次还要赌吗'),
]


async def main():
    rows = []
    with tempfile.TemporaryDirectory() as t:
        bot = CharacterRuntime(SimpleNamespace(search=AsyncMock(return_value=[])),
                               world_path=Path(t) / 'w', social_path=Path(t) / 's',
                               owner='synthetic-owner')
        for name, text in CASES:
            c = await bot.prepare(text, 'synthetic_A', 'group:680823437', 'synthetic-' + name, [])
            tick = time.monotonic()
            try:
                payload, _ = await school.generate(bot.messages(c), output_limit=800, scope='synthetic')
                answer = payload['choices'][0]['message']['content']
                errors = bot.check(answer, c)
                rows.append({'case': name, 'question': text, 'answer': answer, 'errors': errors,
                             'seconds': round(time.monotonic() - tick, 2),
                             'usage': payload.get('usage'), 'chars': len(answer)})
            except school.Blocked as exc:
                rows.append({'case': name, 'question': text, 'error': exc.code})
            print(json.dumps({k: rows[-1].get(k) for k in ('case', 'answer', 'errors', 'error', 'seconds')},
                             ensure_ascii=False), flush=True)
            await asyncio.sleep(3)
    out = Path(__file__).resolve().parents[1] / 'cloud-investigation/tongji-live-20261027/obedience-replay-20261028.json'
    out.write_text(json.dumps({'synthetic_only': True, 'qq_sends': 0, 'rows': rows},
                              ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'saved': str(out), 'with_errors': sum(1 for r in rows if r.get('errors'))},
                     ensure_ascii=False))


asyncio.run(main())
