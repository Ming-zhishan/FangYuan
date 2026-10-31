"""Import local static bundles through the installed A_Memorix kernel lifecycle."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]
os.environ['MAIBOT_INSTANCE_DIR'] = str(ROOT / 'work/instance')
from src.config.config import config_manager
from src.A_memorix.host_service import AMemorixHostService
from src.A_memorix.paths import repo_root
from src.A_memorix.core.runtime.sdk_memory_kernel import SDKMemoryKernel
from src.A_memorix.core.runtime.models import KernelSearchRequest


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path, action='append', default=[])
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    assert (ROOT / 'work/instance/eula.confirmed').exists(), 'Agreement confirmation missing'
    config_manager.initialize()
    config = AMemorixHostService._config_model_to_runtime_dict(config_manager.get_global_config().a_memorix)
    kernel = SDKMemoryKernel(plugin_root=repo_root(), config=config)
    report = {'imports': [], 'searches': [], 'live_qq_started': False}
    try:
        await kernel.initialize()
        # Observe the actual embedding provider before checking precomputed-vector identity.
        # Native initialization may defer this probe to a background recovery task.
        probe = await kernel.embedding_manager.encode(['方源资料库向量一致性检查'])
        assert len(probe[0]) == 1024
        assert kernel._current_embedding_fingerprint_for_validation() is not None
        print(json.dumps({'stage': 'native_kernel_initialized'}), flush=True)
        for source in args.bundle:
            target = kernel.data_dir / 'imports' / source.name
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.resolve() != target.resolve():
                if target.exists():
                    assert source.read_bytes() == target.read_bytes(), 'Existing import differs; use another version'
                else:
                    shutil.copy2(source, target)
            result = await kernel.memory_bundle_admin(action='import', path=str(target), scope_type='global', mode='merge')
            report['imports'].append({'file': source.name, 'result': result})
            print(json.dumps({'stage': 'import_returned', 'file': source.name, 'result': result}, ensure_ascii=True), flush=True)
        report['embedding_recovery'] = await kernel._recover_embedding_once(sample_text='方源原著与研究资料检索检查')
        print(json.dumps({'stage': 'embedding_recovery', 'success': report['embedding_recovery'].get('success')}), flush=True)
        for query in ['三王传承里，方源两次炼蛊结果一样吗？', '仙蛊唯一，是天下只能有一只仙蛊吗？', '方源为什么追求永生？', '方源成尊后仍有什么限制？']:
            result = await kernel.search_memory(KernelSearchRequest(query=query, limit=3, group_id='680823437', user_id='2449113325'))
            report['searches'].append({'query': query, 'result': result})
        report['wrong_group'] = await kernel.search_memory(KernelSearchRequest(query='方源', limit=1, group_id='1', user_id='2449113325'))
    finally:
        await kernel.shutdown()
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
    print(json.dumps({'stage': 'finished', 'report': str(args.report), 'qq_messages_sent': 0}), flush=True)


if __name__ == '__main__':
    asyncio.run(main())
