"""Select explicitly allowlisted private, group, or combined mode."""
import argparse
import json
from pathlib import Path
import shutil
import tomlkit

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['private_test','group','both'], required=True)
    args = parser.parse_args()
    identity = json.loads((ROOT/'work/private/character-identity.json').read_text(encoding='utf-8'))
    owner, group = str(identity['special_friend_qq']), str(identity['allowed_group'])
    private_test = args.mode == 'private_test'
    policy_path = ROOT/'work/instance/config/adapter_policy.toml'
    bot_path = ROOT/'work/instance/config/bot_config.toml'
    backup = ROOT/'work/private/config-before-private-test'
    backup.mkdir(exist_ok=True)
    for path in [policy_path,bot_path]:
        if not (backup/path.name).exists():
            shutil.copy2(path,backup/path.name)
    policy = tomlkit.parse(policy_path.read_text(encoding='utf-8'))
    qq = next(a for a in policy['adapters'] if a['platform'] == 'qq')
    qq['group']['allow_ids'] = [] if private_test else [group]
    qq['private']['allow_ids'] = [owner] if args.mode in {'private_test','both'} else []
    qq['private']['default_action'] = 'block'
    bot = tomlkit.parse(bot_path.read_text(encoding='utf-8'))
    bot['a_memorix']['filter']['chats'] = (['user:'+owner] if private_test else ['group:'+group,'user:'+owner] if args.mode=='both' else ['group:'+group])
    for path, doc in [(policy_path,policy),(bot_path,bot)]:
        temp = path.with_suffix('.toml.tmp')
        temp.write_text(tomlkit.dumps(doc),encoding='utf-8')
        temp.replace(path)
    mode_file = ROOT/'work/private/chat-mode.json'
    temp = mode_file.with_suffix('.json.tmp')
    # MaiBot's legacy DM adapter remains narrow; the dedicated receiver handles
    # verified friends and keeps private transcripts out of the group planner.
    temp.write_text(json.dumps({'mode':args.mode,'private_test_qq':owner,'group_qq':group,
        'private_access':'verified_friends' if args.mode=='both' else 'bound_test' if private_test else 'disabled',
        'private_receiver':'dedicated_friend_channel','private_proactive':False},indent=2),encoding='utf-8')
    temp.replace(mode_file)
    print(json.dumps({'mode':args.mode,'private_test_enabled':private_test,'group_enabled':not private_test}))


if __name__ == '__main__':
    main()
