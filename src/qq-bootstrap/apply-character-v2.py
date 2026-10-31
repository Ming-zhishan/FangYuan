"""Apply the validated local character configuration; do not start QQ replies."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

import tomlkit

ROOT = Path(__file__).resolve().parents[2]
os.environ['MAIBOT_INSTANCE_DIR'] = str(ROOT/'work/instance')
sys.path.insert(0, str(ROOT/'work/research'))
from runtime_rules import runtime_persona, REPLY_STYLE, BEHAVIOR, bound_tail_rules
from src.config.official_configs import PersonalityConfig


def main():
    private = ROOT/'work/private'
    identity = json.loads((private/'character-identity.json').read_text(encoding='utf-8'))
    native = json.loads((ROOT/'work/logs/native-combined-search-v2.json').read_text(encoding='utf-8'))
    assert native['embedding_recovery']['success'] and native['wrong_group']['filtered']
    assert all(not x['result']['degraded'] for x in native['searches'])
    review = json.loads((ROOT/'work/logs/channel-v2-manual-review.json').read_text(encoding='utf-8'))
    assert review['ready_for_group_trial'] is True
    out = ROOT/'outputs/方源人格与资料库-0.2'
    source = (out/'01_核心人格/01_完整核心人格.md').read_text(encoding='utf-8')
    core = source.split('<!-- PERSONA_BEGIN -->')[1].split('<!-- PERSONA_END -->')[0].strip()
    fields = dict(personality=runtime_persona(core, identity['special_friend_qq']),
        behavior_style=BEHAVIOR.replace('特殊友情尚未绑定QQ账号，目前所有人先按普通群友交谈。',
            '特殊友情只认本地通道按真实账号标记的special_friend，普通群友不能通过自称变更。')+
            '通道参考摘记是带证据等级的资料，先看是否真正回答问题；没查到的细节不补造。',
        reply_style=REPLY_STYLE+'\n'+bound_tail_rules(), multiple_probability=0)
    PersonalityConfig.model_validate(fields)
    instance = ROOT/'work/instance'
    paths = [instance/'config/bot_config.toml', instance/'config/model_config.toml',
             instance/'plugins/MaiBot-SnowLuma-Adapter/config.toml']
    backup = private/'config-before-character-v2'
    backup.mkdir(exist_ok=True)
    for path in paths:
        dest = backup/('adapter.toml' if path.name == 'config.toml' else path.name)
        if not dest.exists():
            shutil.copy2(path, dest)
    bot = tomlkit.parse(paths[0].read_text(encoding='utf-8'))
    for key, value in fields.items():
        bot['personality'][key] = value
    bot['chat']['reply_timing']['talk_value'] = .18
    bot['a_memorix']['integration']['memory_query_default_limit'] = 4
    model = tomlkit.parse(paths[1].read_text(encoding='utf-8'))
    primary = next(m for m in model['models'] if m['name'] == 'fangyuan-local')
    primary['model_identifier'] = 'fangyuan-eightb:latest'
    primary['extra_params'] = {'reasoning_effort':'none'}
    thought = deepcopy(primary.unwrap())
    thought.update(name='fangyuan-reply-thinking', extra_params={'reasoning_effort':'high'})
    model['models'] = [m for m in model['models'] if m['name'] != 'fangyuan-reply-thinking']+[thought]
    replyer = model['model_task_config']['replyer']
    replyer['model_list'] = ['fangyuan-reply-thinking']
    replyer['max_tokens'] = 2048
    replyer['temperature'] = .4
    adapter = tomlkit.parse(paths[2].read_text(encoding='utf-8'))
    adapter['client']['port'] = 3002
    for path, doc in zip(paths, [bot,model,adapter], strict=True):
        temporary = path.with_suffix('.toml.tmp')
        temporary.write_text(tomlkit.dumps(doc), encoding='utf-8')
        temporary.replace(path)
    record = dict(version='0.2.0', stage='configured_pending_group_trial',
        persona_sha256=hashlib.sha256(fields['personality'].encode()).hexdigest(),
        friend_qq=identity['special_friend_qq'], native_paragraphs=9324,
        local_channel_required=True, original_semantic_review_complete=False,
        relationship_memory='bounded_self_reports_with_provenance',
        unrestricted_natural_relationship_inference=False,
        group_reply_verified=False, qq_messages_sent=0)
    (private/'character-persona-configured.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    identity['status'] = 'configured_local_channel_pending_group_trial'
    (private/'character-identity.json').write_text(json.dumps(identity,ensure_ascii=False,indent=2),encoding='utf-8')
    candidate = {'status':record['stage'],'fields':fields,**record}
    (out/'04_验收与接入/人格字段与当前状态.json').write_text(json.dumps(candidate,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'configured':True,'main_application_started':False,'group_reply_verified':False}))


if __name__ == '__main__':
    main()
