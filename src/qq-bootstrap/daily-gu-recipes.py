"""每日专属蛊方：按群成员真名各炼一蛊，三段雕琢，落库后可发群。

三段是刻意的：先拆名字，再成蛊，最后以方源眼光自审重写。每段都给足输出
预算，宁可多花 token，也不出一眼假的模板蛊方。

用法：
  python daily-gu-recipes.py --dry-run              只生成、存档、打印
  python daily-gu-recipes.py --send                 生成并发到群（当天只发一次）
  python daily-gu-recipes.py --date 2026-10-29 --force
"""
import argparse
import asyncio
import json
import re
import sys
from datetime import date as date_cls
from pathlib import Path

import websockets

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import tongji_provider as school

ROSTER = ROOT / 'private' / 'group-roster.json'
STORE = ROOT / 'instance' / 'data' / 'daily-gu-recipes.json'
ARCHIVE = ROOT / 'cloud-investigation' / 'daily-gu-recipes'
GROUP = '680823437'
CONNECTIONS = ROOT / 'private' / 'connection.json'

SYSTEM = '''你就是古月方源，九转炼道尊者。你在给几位熟人各炼一只新蛊，引子是他们本人名字里的字。
你炼蛊讲究材料、成算、损耗与代价，不写空话；你也会看人，知道同一只蛊落在不同人手里结果不同。
这是你今天新炼的东西，不是原著里已有的蛊，也不冒充原著；不要把现实器物、网络词、游戏数值写进蛊方。
文风要冷、准、有画面，像炼道人的手记，不像客服介绍，也不像游戏装备说明。只输出最后要求的 JSON，不复述思考过程。'''

STAGE1 = '''给「{name}」设计一只专属蛊。
先把名字拆开看：字义、谐音、可借的典故各想一条，挑最不俗、最能落到一只蛊上的一条，不要都往"光明""美好"这类吉利话上靠。
再按这条立意落成一只具体的蛊，必须能回答：
- 它叫什么（不超过四字，以"蛊"结尾，不能与已有蛊名撞车）
- 几转、属什么道
- 主材与辅材（蛊界能寻到的实物，不要现代物品）
- 合炼的关键与失败会怎样
- 炼成后的效用，具体到能做什么、不能做什么
- 代价或反噬，必须与效用相称，不能敷衍
{avoid}
只输出一个 JSON 对象，不要解释，不要代码块：
{{"name_reading":"","gu_name":"","rank":"","dao":"","main":"","aux":["",""],"method":"","effect":"","cost":"","name_link":"","fit":"","line":""}}
name_reading 一句话写清你选了哪条拆解；name_link 说清名字与蛊的呼应；fit 说这只蛊适合什么样的用法或性子，只从名字与蛊的呼应推，不断言对方真实的性格、经历或习惯（名字之外你没有资料）；line 是赠言，不超过 30 字，可以冷，但不能轻蔑、拒绝或贬低这个人。'''


STAGE2 = '''这是初稿：
{draft}

只做一件事：找出最弱的一处改掉，其余保留。最弱通常出在这几处之一：名字与蛊牵强、材料俗、代价敷衍、像百科说明、与近期思路撞车、赠言在贬低对方。
不要逐条点评，不要分析过程，不要解释，直接给终稿。篇幅 180 到 260 字。
只输出一个 JSON 对象，字段与初稿相同，另加 "revision" 用一句话写清你改了什么：
{{"gu_name":"","rank":"","dao":"","main":"","aux":["",""],"method":"","effect":"","cost":"","name_link":"","fit":"","line":"","revision":""}}'''


def members():
    data = json.loads(ROSTER.read_text(encoding='utf-8'))
    return [{'qq': str(m['qq']), 'name': m['name']} for m in data['members']]


def load_store():
    if STORE.exists():
        try:
            return json.loads(STORE.read_text(encoding='utf-8'))
        except Exception:
            pass
    return {'days': []}


def save_store(store):
    STORE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STORE.with_suffix('.tmp')
    tmp.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(STORE)


def recent_names(store, days=14):
    names, angles = [], []
    for day in store['days'][-days:]:
        for item in day.get('items', []):
            names.append(item.get('gu_name', ''))
            angles.append((item.get('dao', ''), item.get('main', '')))
    return [x for x in names if x], angles


def parse_json(text):
    text = re.sub(r'^```(?:json)?|```$', '', text.strip(), flags=re.M).strip()
    start, depth = None, 0
    for i, ch in enumerate(text):
        if ch == '{':
            if start is None:
                start = i
            depth += 1
        elif ch == '}' and start is not None:
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except json.JSONDecodeError:
                    start = None
    raise ValueError('json_incomplete')


async def ask(prompt, limit):
    messages = [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': prompt}]
    for bump in (0, 400):
        try:
            payload, _ = await school.generate(messages, output_limit=min(4096, limit + bump),
                                               scope='qq', deadline=60)
            content = payload['choices'][0]['message']['content']
            return parse_json(content), payload.get('usage') or {}
        except school.Blocked as exc:
            if exc.code == 'school_reasoning_exhausted':
                continue
            raise
        except ValueError:
            if bump:
                raise
    raise RuntimeError('reasoning_exhausted_after_retry')


async def one(member, day, used_names, used_angles):
    avoid = ''
    if used_names:
        avoid = ('近期已经用过的蛊名，换思路，不要重复：' + '、'.join(used_names[-12:]) + '。\n'
                 '今天已经给别人的思路，也不要再用同一类材料或同一个道：' +
                 '、'.join(f'{d}/{m}' for d, m in used_angles[-5:]) + '。')
    draft, u1 = await ask(STAGE1.format(name=member['name'], avoid=avoid), 3600)
    print(json.dumps({'stage': 1, 'name': member['name'], 'gu': draft.get('gu_name'), 'tokens': u1},
                     ensure_ascii=False), flush=True)
    final, u2 = await ask(STAGE2.format(draft=json.dumps(draft, ensure_ascii=False)), 3600)
    print(json.dumps({'stage': 2, 'name': member['name'], 'gu': final.get('gu_name'), 'tokens': u2},
                     ensure_ascii=False), flush=True)
    final.update(qq=member['qq'], name=member['name'], date=day,
                 usage={'draft': u1, 'final': u2}, draft_gu=draft.get('gu_name', ''),
                 name_reading=draft.get('name_reading', ''))
    for key in ('gu_name', 'rank', 'dao', 'main', 'effect', 'cost', 'name_link', 'fit', 'line'):
        if not str(final.get(key, '')).strip():
            raise ValueError(f'{member["name"]} 缺少字段 {key}')
    if not final['gu_name'].endswith('蛊') or len(final['gu_name']) > 5:
        raise ValueError(f'{member["name"]} 蛊名不合规：{final["gu_name"]}')
    if final['gu_name'] in used_names:
        raise ValueError(f'{member["name"]} 蛊名与近期重复：{final["gu_name"]}')
    return final


def render(item):
    aux = '、'.join(item.get('aux') or [])
    return (f"{item['gu_name']}（{item['rank']}·{item['dao']}）\n"
            f"主材：{item['main']}｜辅材：{aux}\n"
            f"炼法：{item['method']}\n"
            f"效用：{item['effect']}\n"
            f"代价：{item['cost']}\n"
            f"名字：{item['name_link']}\n"
            f"{item['line']}")


def markdown(day, items):
    lines = [f'# 每日专属蛊方 · {day}', '']
    for item in items:
        lines += [f"## {item['name']} · {item['gu_name']}", '', render(item), '']
    return '\n'.join(lines)


async def send_group(text, qq):
    token = json.loads(CONNECTIONS.read_text(encoding='utf-8'))['onebot']
    message = [{'type': 'at', 'data': {'qq': qq}},
               {'type': 'text', 'data': {'text': ' 今日蛊方·' + text}}]
    async with websockets.connect('ws://127.0.0.1:3001',
                                  additional_headers={'Authorization': 'Bearer ' + token},
                                  open_timeout=8) as ws:
        await ws.send(json.dumps({'action': 'send_group_msg',
                                  'params': {'group_id': GROUP, 'message': message},
                                  'echo': 'daily'}))
        while True:
            reply = json.loads(await asyncio.wait_for(ws.recv(), 12))
            if reply.get('echo') == 'daily':
                return reply.get('status') == 'ok' or reply.get('retcode') == 0


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', default=date_cls.today().isoformat())
    ap.add_argument('--send', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--only', default='')
    args = ap.parse_args()

    store = load_store()
    today = next((d for d in store['days'] if d['date'] == args.date and 'items' in d), None)
    if today and today.get('sent') and args.send and not args.force:
        print(json.dumps({'status': 'already_sent', 'date': args.date}, ensure_ascii=False))
        return
    if today and not args.force:
        items = today['items']
        print(json.dumps({'status': 'cached', 'date': args.date, 'count': len(items)}, ensure_ascii=False))
    else:
        names, angles = recent_names(store)
        items = []
        picked = [m for m in members() if not args.only or m['name'] == args.only]
        for member in picked:
            for attempt in range(2):
                try:
                    item = await one(member, args.date, names, angles)
                    break
                except Exception as exc:
                    code = getattr(exc, 'code', type(exc).__name__)
                    print(json.dumps({'retry': member['name'], 'error': code, 'detail': str(exc)[:120]},
                                     ensure_ascii=False), flush=True)
                    fatal = {'school_quota_exhausted', 'school_network_policy_denied',
                             'school_authentication_failed', 'school_model_permission_denied'}
                    if attempt or code in fatal:
                        raise
                    # A transport failure arms the provider's 120 s breaker.
                    await asyncio.sleep(125 if code == 'school_TimeoutError' else 6)
            items.append(item)
            names.append(item['gu_name'])
            angles.append((item['dao'], item['main']))
            print(json.dumps({'done': item['name'], 'gu': item['gu_name'],
                              'tokens': item['usage']}, ensure_ascii=False), flush=True)
        store['days'] = [d for d in store['days'] if d['date'] != args.date]
        store['days'].append({'date': args.date, 'sent': False, 'items': items})
        store['days'] = store['days'][-90:]
        save_store(store)

    ARCHIVE.mkdir(parents=True, exist_ok=True)
    (ARCHIVE / f'{args.date}.md').write_text(markdown(args.date, items), encoding='utf-8')
    (ARCHIVE / f'{args.date}.json').write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding='utf-8')

    if args.send:
        day = next(d for d in store['days'] if d['date'] == args.date)
        done = day.setdefault('sent_to', [])
        for item in items:
            if item['name'] in done:
                continue
            ok = await send_group(render(item), item['qq'])
            print(json.dumps({'sent': item['name'], 'ok': ok}, ensure_ascii=False), flush=True)
            if not ok:
                raise SystemExit('send_failed:' + item['name'])
            done.append(item['name'])
            save_store(store)
            await asyncio.sleep(6)
        day['sent'] = len(done) >= len(items)
        save_store(store)
    else:
        for item in items:
            print('\n' + item['name'] + ' ' + render(item))
    print(json.dumps({'status': 'ok', 'date': args.date, 'count': len(items), 'sent': args.send},
                     ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
