"""Produce reviewable deliverables without private credentials, personal DBs, or novel full text."""
import hashlib
import json
from pathlib import Path
import shutil
import statistics
import tomllib
from datetime import datetime

from character.prompts import CORE,PLANNER
from character.knowledge import CARDS
from character.state import PHASES

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'outputs/方源人格优化-0.3'


def write(name,body):
    path=OUT/name
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(body,encoding='utf-8')


def cell(value):
    return str(value).replace('|','／').replace('\n','<br>')


def main():
    OUT.mkdir(exist_ok=True)
    before=json.loads((ROOT/'work/logs/persona-before-v3.json').read_text(encoding='utf-8'))
    after=json.loads((ROOT/'work/logs/persona-current-v3.json').read_text(encoding='utf-8'))
    multi=json.loads((ROOT/'work/logs/persona-extended-current-v3.json').read_text(encoding='utf-8'))
    # The initial harness retained the prior trace when a request failed before completion.
    # Keep its failed output/time intact, but never attribute a prior answer's trace to this query.
    for report in [after,multi]:
        for row in report['cases']:
            if row.get('error'):
                row['trace']={'incomplete_trace':True,'note':'调用失败；不沿用上一题的轨迹。'}
    for name,data in [('测试/修改前11题.json',before),('测试/当前版11题.json',after),('测试/多人连续对话.json',multi)]:
        write(name,json.dumps(data,ensure_ascii=False,indent=2))
    optional=['persona-candidate-v3.json','persona-extended-candidate-v3.json','persona-casual-thinking-probe.json','persona-composer-probe.json',
              'persona-deployed-v3.json','persona-extended-deployed-v3.json','persona-final-adaptive-v3.json','persona-extended-final-adaptive-v3.json',
              'persona-final-stage-check-v3.json',
              'persona-speed-v3.json','persona-v3-source-hashes.json','persona-v3-runtime-verification.json']
    for name in optional:
        path=ROOT/'work/logs'/name
        if path.exists():
            data=path.read_text(encoding='utf-8')
            if name=='persona-speed-v3.json':
                data=json.dumps({'note':'最终自适应路由之前的全思考与强制快答对照；不是当前默认闲聊耗时。','cases':json.loads(data)},ensure_ascii=False,indent=2)
            write('测试/'+name,data)
    write('原著视角锚点.json',json.dumps({'note':'事实段与本人判断边界分开；后者是有依据的角色设计，不是逐字原著引文。','cards':CARDS},ensure_ascii=False,indent=2))
    write('核心与参与提示词.md',f'''# 当前生效的提示词

核心 {len(CORE)} 字符；并非把全书或几万字设定常驻在上下文中。

## Replyer 核心

{CORE}

## Planner 参与规则

{PLANNER}

## 每轮补充

- 当前真实发言账号及其可信朋友关系。
- 与当前话题相关的自述，明确记忆主体是对方；不把爱好塞进每次对话。
- 问到手头事务才提供持续日常状态；问出处时区分生活设定与原著。
- 命中人物时提供身份、已核经历及判断边界；否则有需要才检索资料。
- 独立新问题不沿用无关旧话题；追问保留相关历史，历史正文总量上限1400字符。
- 报备、体验抱怨、前景判断采用不同表达要求；一般不超过两句。

这是生成规则，不包含11道验收题的完整示例答案。资料库事实或社交记忆在两次生成仍出错时可以直接作兜底；报备与人机抱怨也有短句兜底。所有兜底在测试轨迹中单列，不能算模型已经理解人物。
''')
    write('人工复核.md',(ROOT/'work/setup/docs/persona-v3-review.md').read_text(encoding='utf-8'))
    write('状态与记忆说明.md',f'''# 四层资料如何分开

| 层次 | 实际位置 | 写入规则 |
|---|---|---|
| 原著及审核资料 | A_Memorix原有固定库、审核向量快照、私有原文索引 | 群聊不自动写入；本轮不改原著正文 |
| 当前生活 | work/instance/data/fangyuan-life.sqlite3 | 一个共享持续事务；明确标为用户授权日常创作 |
| 群友记忆 | work/instance/data/fangyuan-social.sqlite3 | 按账号和私聊/群聊范围分隔的自述、纠正与真实互动 |
| 短期对话 | 原生麦麦消息库及 character-private-dialogue.sqlite3 | 最新真实消息优先；按当前意图选取历史 |

## 当前日常

{chr(10).join(f'{i+1}. {activity}；{continuity}。' for i,(activity,continuity) in enumerate(PHASES))}

每次询问不会随机换任务。状态在SQLite事务中保存，重启、换群友询问都沿用同一项目。只有追问进展且距上次推进至少4小时，才向下一小阶段推进，最多到第3阶段；没有无限自动续写或重大剧情推演。将来要换日常项目，应明确更新状态，不能把模型临时编出的数量、交货日、突破当成事实回写。

## 社交记忆

支持明确称呼、自述身份、喜欢/不喜欢、近期学习备考目标、明确观点、“记住：…”与“更正：…”。这些仍是当事人自述，不是经过外部验证的客观事实。引用、明显玩笑和假设不据此永久贴性格标签。自称主人、管理员或换号不能取得可信朋友身份。

每条事实保留账号、范围、来源消息、时间、类型、是否有效；更正按相关字段或明确提及的旧内容失效，不把同一人的所有旧事实一笔抹掉。旧库保留。最近100条有效候选中按话题选最多5条；不相关的爱好不会常驻在原著或考试话题里。有限说话习惯只描述近期短句占比，不推断人格缺陷，不设好感度。

共同经历以实际发出的回复为准：私聊在QQ确认发送成功后记录；群聊使用原生 send_service.after_send。原始互动长期留存，但当前共同经历回忆只提供最近3条已确认对话，尚不是完整的多年语义记忆系统。

私聊里的个人自述不自动公开到群里；角色在蛊界的当前事务属于共享世界状态。

## 第一人称资料处理

1. 七张身份/经历锚点提供性别、阶段、关系和分支，事实与角色理解分开。
2. 审核研究卡只提取事实段，排除设计说明、示例和回复指令。将事实摘要里的本人姓名改成“我”只是语法辅助，不代表自动完成语义核验。
3. 原文片段保留证据属性和说话人边界，不把所有原文里的“我”都当成方源。没有全书逐段完成视角标注。
4. 输出检查只覆盖已知错误类型：身份、若干性别/修为/因果、重复、串号、部分无依据的新活动等，不是通用的事实证明器。

新核阅处包括凤九歌/命运歌、洪亭的悔、谢晗沫相关回忆。红莲爱人应为“柳淑仙”，旧研究卡的“刘淑仙”是误写；当前锚点和输出检查纠正它。0.2历史包保持原样，不把修订冒充原著正文改动。
''')
    table=['| 问题 | 修改前真实输出 | 当前版真实输出 | 秒 | 生成次数／兜底 |','|---|---|---|---:|---|']
    old={r['id']:r for r in before['cases']}
    for row in after['cases']:
        trace=row.get('trace') or {}
        table.append('| '+' | '.join(map(cell,[row['query'],old[row['id']]['answer'],row['answer'] or row.get('error'),row['seconds'],
            f"{len(trace.get('attempts',[]))}／{trace.get('fallback','未完成')}"]))+' |')
    write('测试/11题逐条对比.md','# 11题真实调用对比\n\n逐字保存正文，没有润色成理想答案。修改前后是不同时间的一次抽样，不代表稳定正确率。秒数是本机当次端到端生成耗时，不能外推为群聊完整耗时。\n\n'+'\n'.join(table)+'\n')
    rows=['| 编号 | 对方原话 | 当前输出 | 秒 | 错误／兜底 |','|---|---|---|---:|---|']
    for row in multi['cases']:
        rows.append('| '+' | '.join(map(cell,[row['id'],row['query'],row['answer'],row['seconds'],row['error'] or ('兜底' if row.get('trace',{}).get('fallback') else '无调用错误')]))+' |')
    write('测试/连续对话逐条记录.md','# 连续对话、换人及未见措辞\n\n“无调用错误”仅表示调用返回，并不等于事实或角色表现合格。测试中有重启状态对象、换用户、自述记忆、冒认身份、错误事实前提、出处和考试倾诉。\n\n'+'\n'.join(rows)+'\n')
    calls=after['cases']+multi['cases']
    failures=sum(bool(r['error']) for r in calls)
    fallbacks=sum(bool(r.get('trace',{}).get('fallback')) for r in calls)
    repairs=sum(len(r.get('trace',{}).get('attempts',[]))>1 for r in calls)
    durations=[r['seconds'] for r in after['cases'] if not r['error']]
    report=f'''# 方源人格优化0.3：实施与验收

生成日期：{datetime.now().isoformat(timespec='seconds')}（本机时间）。

## 结论

已经完成本地实现、备份、实际模型调用和SDK加载检查。当前依然是本机Qwen3 8B，未接收费API。

工程上已拆开资料、持续生活、社交记忆和短期上下文，修复资料冒充群消息及部分重复/串号来源；但没有达到“完整还原、有完整人生思想体系”的最终标准。8B仍会生硬接梗、乱用比喻、概括过度或产生检查未覆盖的细节。请把本包看作有验证、有回退的改进版，不是人格完成证明。

## 技术诊断

1. **漏答不只是人设问题。** 旧日志中直接私聊问题被原生Planner决定不回复，且多轮工具、消息防抖和分段打字增加耗时。之前已部署的私聊直接应答路径予以保留，不再让私聊经过群聊参与决策。
2. **辅助资料被放进真实群消息。** 旧通道把身份JSON和长研究卡直接塞入正文；姓名和叙述可能影响提及检测、话题选择与角色视角。本轮移除，保持群友正文，内部通过SDK真实账号和准备上下文处理。
3. **过去内容一直侵入新话题。** 原先把近期所有对答、人物喜好和生活事务都放入每轮，实测会把考试答成棋局、把别人的喜好混过来。本轮按当前意图选择历史；生活与个人自述也按相关性提供。
4. **检索不是人格理解。** 第三人称研究说明、模仿建议和跨阶段资料会诱发百科口吻与错因果。本轮提取事实段、补七张视角锚点，并保留阶段/分支和事实边界。
5. **模型本身仍是瓶颈。** 已验证模型模板能传系统指令，实际参数为Qwen3 8B Q4_K_M。多次候选中，模型即使读到正确性别、阶段和规则，也会主动补造细节。继续堆字数没有解决这一点；失败候选也保存了。

## 实际改动

| 部分 | 已实施行为 |
|---|---|
| Planner | 群内只管是否参与：直接提问/@优先一次答，普通互聊克制，不重复同一消息，不为闲聊反复查资料 |
| Replyer | 精简核心、当前问题优先、事实/状态/关系分层；通常一两句；普通生成一次，发现已知一致性问题最多额外修正一次 |
| 私聊 | 保留最新消息抢先、消息ID去重、失败明确回复和22秒期限；旧答复不再默认灌入新人格，旧库不删除 |
| 群聊 | 用SDK公开的planner/replyer请求、响应和发送hooks；发送成功才记共同经历；已确认答过的来源消息阻止再次发送 |
| 生活 | 一个持久项目，有限阶段，4小时以上且询问进展才推进；不随机换事件，不自动续写世界大事 |
| 社交 | SQLite独立证据账本，按账号和场景分隔；自述、纠错、真实互动与有限观察分开，无好感度 |
| 配置 | 核心替换旧长提示；停用随机备用风格及本次回复拆分；减少旧回忆路径干扰，保留固定原著查询 |
| 部署 | 共享纯Python角色模块＋薄SDK插件，没有改安装包src或原著正文；保留配置、代码及SQLite一致性备份 |

Planner和Replyer底层均为 `fangyuan-eightb:latest`：Planner使用不思考配置；Replyer普通闲聊不思考，原著证据题及较认真的选择题用思考配置。私聊直接复用同一表达模块，省去Planner；“快答：…”可强制首轮不思考，但若命中检查仍可能追加一次思考修正。全思考实验没有可靠改善闲聊，却使日常问句花8至11秒，所以没有把它作为最终普通闲聊默认。

本轮没有给A_Memorix打开自动人物事实/摘要/画像写回，避免把群友内容写进固定原著库。原生SDK消息查询、模型选择、请求快照协议和发送确认被复用；独立的社交账本负责本次需要的证据分类和范围隔离。

## 真实测试

- 原版基线11题；当前版11题；另有连续换人/新措辞22题，共33条当前测试。
- 当前调用失败：{failures}；发生额外修正：{repairs}；使用兜底：{fallbacks}。这些是机制计数，不是人格合格率。
- 当前11题返回样本中位耗时约{statistics.median(durations):.1f}秒，最大{max(durations):.1f}秒。思考模式和额外修正仍有明显成本，不能声称已经做到即时回复。
- 调用的是真实本机模型；没有把测试消息发送给QQ群或好友。SDK通过安装版1.3.12独立实例加载验证；多人测试仍是本地构造的群聊序列，不能代替QQ群现场验收。
- 20项程序回归验证覆盖持久化、有限推进、消息去重/抢先/超时、账号范围隔离、纠错、SDK快照与发送成功后记忆等；不把程序检查通过等同于语言表现通过。

33题抽样之后又补上了其他玄幻境界词检查及普通报备超时的短句兜底。“还没飞升”是最后抽样里暴露的新错误，额外修订后对修为题再作真实调用补测，单列 `persona-final-stage-check-v3.json`。没有重写33题里原来的失败输出，也没有宣称额外规则已经覆盖所有新错误。

完整正文见[11题逐条对比](测试/11题逐条对比.md)、[连续对话记录](测试/连续对话逐条记录.md)。JSON保留每次尝试的输出、错误、引用和是否兜底。单次成功和已知错误规则都不能证明面对所有新问题稳定正确。

逐项判断见[人工复核](人工复核.md)：其中保留了跑题、生活活动编造、分支说明不足和修为题靠兜底的失败证据。

## 原著与设计边界

当前版本沿用既有私有原著和审核资料，不声称已经逐段精读全书。先前隔离的两段错章保持隔离，原著文件未被覆写。新增视角锚点有明确来源编号；判断边界是角色设计而非伪造引文，详见[锚点文件](原著视角锚点.json)。

对“柳淑仙”的纠错在当前锚点和生成检查层生效，0.2包保留为历史快照，不能据此宣称旧包里每个条目都已被物理更新。

## 尚未解决与下一步价值

1. **语言和观点稳定性未过最终验收。** 日常接梗、轻重判断、思想深度仍有明显8B限制；规则只拦已知错误，不能兜住所有编造。应优先用未见对话持续评估，不用新增几万字设定替代验证。
2. **本地速度仍需取舍。** 思考题更慢；不思考更容易出现未经校验的发挥。没有新增付费服务。若以后升级模型，应拿本包同一测试集及新题比较，先验证再换默认模型。
3. **关系发展只是轻量起点。** 已有可追溯自述与真实互动，尚未实现稳定的复杂心理画像、多年语义经历检索或自动成熟关系推理。
4. **生活只是一项有限持续事务。** 能连续、可回退，尚不是自主生活模拟，也不自动改变原著世界局势。
5. **真实群聊未测。** 读取QQ状态时账号3816636861仍未加入680823437。目前保留2449113325的私聊测试模式。入群后还要现场确认群聊参与频率、真实@及多人成员交错时的表现。

## 使用、回退和文件

先在QQ私聊现有方源小号直接交流，无需重新扫码或填API密钥。电脑和本地服务需要保持运行。使用方式见[使用手册](使用手册.md)。

新增回退入口会恢复本轮前配置与本地实现，停用新增插件，保留新聊天和新数据库供核对，不删除原著。`实现快照`仅供审阅；正在运行的实现位于本工作区work目录，勿把审阅副本直接当安装程序执行。

清单的本地HTTP地址是宿主要求的未发布插件占位元数据，不代表代码已托管到外网。
'''
    write('实施与验收报告.md',report)
    manual='''# 方源使用手册

当前先用QQ私聊3816636861，允许测试的朋友账号是2449113325。

- 正常直接发话；一般一两句，原著问题会按需查资料。
- 日常默认走快速生成；原著、认真选择题会思考。想强制更快可加“快答：”，例如“快答：你现在实力咋样？”。纠错仍可能花时间。
- 问“在做什么”“上次那件事有进展吗”，会沿用同一件蛊界事务，不随机换项目。
- “以后叫我…”“我叫…”“我是…”“我喜欢…”“我不喜欢…”“我正在学习…”“我认为…”可记录明确自述。
- 用“更正：…”指出具体哪件事错了；不要把一句玩笑当成原著事实。记忆不是每句自动抽取。
- 不需要把整本书再发到QQ。问精确章节或原话时，仍可能因资料/模型能力不足而答不准。
- 思考题比日常慢，遇到已知错误会额外修正一次；普通问题超时会明确提示，简单报备用短句兜底。

电脑必须开机，本地服务运行。双击外层“启动私聊测试.cmd”可恢复私聊服务，“停止方源.cmd”可停止。

群聊目前尚未启用：先把3816636861拉入680823437，再双击外层“启动方源.cmd”。群聊与私聊测试模式互斥。群里直接@或明确向方源提问优先回答，普通互聊是否参与仍由Planner判断；不是每条群消息必回。

需要回到本轮优化前，可运行外层“恢复人格优化前版本.cmd”。这会恢复旧实现并回到私聊测试模式，保留原著和已保存聊天。

人格效果仍未达到完整还原标准；具体成功与失败样本都在本文件夹的测试记录中。
'''
    write('使用手册.md',manual)
    # Snapshot only our source; never distribute credentials, SQLite personal history or novel text.
    files=list((ROOT/'work/setup/character').glob('*.py'))
    files += [ROOT/'work/setup'/name for name in ['private_replies.py','character-channel.py','character_retrieval.py','deploy-persona-v3.py','rollback-persona-v3.ps1','evaluate-persona-v3.py','evaluate-persona-extended.py','test_character_v3.py','test_private_replies.py','test_character_channel.py']]
    files += list((ROOT/'work/setup/plugin-src/fangyuan-continuity').glob('*.*'))
    for source in files:
        relative=source.relative_to(ROOT/'work/setup')
        dest=OUT/'实现快照'/relative
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source,dest)
    bot=tomllib.loads((ROOT/'work/instance/config/bot_config.toml').read_text(encoding='utf-8'))
    model=tomllib.loads((ROOT/'work/instance/config/model_config.toml').read_text(encoding='utf-8'))
    config={'personality':bot['personality'],'response_splitter':bot['response_splitter'],
            'context':{k:bot['chat'][k] for k in ['max_context_size','max_private_context_size','mid_term_memory']},
            'model_tasks':{k:model['model_task_config'][k] for k in ['planner','replyer','fast_model']}}
    write('配置变更快照.json',json.dumps(config,ensure_ascii=False,indent=2))
    write('测试/程序回归结果.txt',(ROOT/'work/logs/persona-v3-all-tests.log').read_text(encoding='utf-8'))
    manifest={p.relative_to(OUT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.rglob('*') if p.is_file() and p.name!='SHA256.json'}
    write('SHA256.json',json.dumps(manifest,ensure_ascii=False,indent=2))
    # User-facing entry point refers to the managed implementation, not to a relocated source snapshot.
    rollback='@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "'+str(ROOT/'work/setup/rollback-persona-v3.ps1')+'"\r\npause\r\n'
    (ROOT/'outputs/恢复人格优化前版本.cmd').write_text(rollback,encoding='gbk')
    (ROOT/'outputs/方源简明使用手册.md').write_text(manual,encoding='utf-8')
    print(json.dumps({'output':str(OUT),'files':len(manifest)+1,'model_cases':len(calls),'request_failures':failures,'fallbacks':fallbacks},ensure_ascii=True))


if __name__=='__main__':
    main()
