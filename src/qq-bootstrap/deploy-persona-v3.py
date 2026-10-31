"""Deploy local extension/config atomically; legacy original-book archive remains read-only."""
import json
from pathlib import Path
import shutil
import sqlite3
import tomlkit

from character.prompts import CORE, PLANNER
from character.social import SocialMemory
from character.state import LifeState

ROOT=Path(__file__).resolve().parents[2]


def main():
    backup=Path(json.loads((ROOT/'work/logs/persona-v3-backup.json').read_text(encoding='utf-8'))['path'])
    target=ROOT/'work/instance/plugins/fangyuan-continuity'
    if target.exists() and not (backup/'fangyuan-continuity').exists():
        shutil.copytree(target,backup/'fangyuan-continuity')
    target.mkdir(exist_ok=True)
    source=ROOT/'work/setup/plugin-src/fangyuan-continuity'
    for name in ['plugin.py','_manifest.json']:
        shutil.copy2(source/name,target/name)
    bot_path=ROOT/'work/instance/config/bot_config.toml'
    bot=tomlkit.parse(bot_path.read_text(encoding='utf-8'))
    bot['personality']['personality']=CORE
    bot['personality']['behavior_style']=PLANNER
    bot['personality']['reply_style']='第一人称直接回应当前话语。闲聊一两句，认真问题可展开；不编经历、不写旁白、不用客服尾巴。具体状态与证据由连续生活插件按需提供。'
    bot['personality']['multiple_probability']=0
    bot['personality']['multiple_reply_style']=[]
    bot['chat']['max_context_size']=16
    bot['chat']['max_private_context_size']=12
    # The shared extension supplies typed social context; avoid extra native recall calls into canon.
    bot['chat']['mid_term_memory']=False
    bot['response_splitter']['enable']=False
    bot['expression']['expression_checked_only']=True
    model_path=ROOT/'work/instance/config/model_config.toml'
    model=tomlkit.parse(model_path.read_text(encoding='utf-8'))
    model['model_task_config']['replyer'].update(temperature=.6,max_tokens=1600,hard_timeout=35.0)
    model['model_task_config']['planner'].update(max_tokens=1600,hard_timeout=35.0)
    model['model_task_config']['fast_model'].update(max_tokens=1600,temperature=.6)
    for path,doc in [(bot_path,bot),(model_path,model)]:
        temporary=path.with_suffix('.toml.tmp')
        temporary.write_text(tomlkit.dumps(doc),encoding='utf-8')
        temporary.replace(path)
    social=SocialMemory()
    old=ROOT/'work/instance/data/character-relationships.sqlite3'
    migrated=0
    if old.exists():
        with sqlite3.connect('file:'+old.resolve().as_posix()+'?mode=ro',uri=True) as db:
            rows=db.execute('SELECT user_id,group_id,message_id,topic,content FROM evidence WHERE active=1 ORDER BY observed_at').fetchall()
        prefixes={'address':'叫我','likes':'我喜欢','dislikes':'我不喜欢','explicit':'记住：','correction':'更正：'}
        for uid,scope,mid,topic,content in rows:
            if topic in prefixes:
                scope=scope if scope.startswith('private:') else 'group:'+scope
                social.observe(uid,scope,mid,prefixes[topic]+content)
                migrated+=1
    state=LifeState().get()
    record={'revision':'v3','plugin_id':'local.fangyuan-continuity','legacy_evidence_rows_processed':migrated,
        'world_project':state['project_id'],'world_phase':state['phase'],'backup':str(backup),
        'native_vendor_files_modified':False,'qq_evaluation_messages_sent':0}
    (ROOT/'work/private/persona-active.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(record,ensure_ascii=True))


if __name__=='__main__':
    main()
