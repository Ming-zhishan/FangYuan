"""Offline bridge for native bundle vectors to the native dual-pool rebuild checkpoint.

The native importer loads vectors but does not register rebuild input hashes. Validate
both fingerprints and byte-exact stored paragraphs before reusing these vectors.
"""
from contextlib import closing
from io import BytesIO
import json
import os
from pathlib import Path
import sqlite3
import zipfile

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
os.environ['MAIBOT_INSTANCE_DIR'] = str(ROOT / 'work/instance')
from src.A_memorix.core.runtime.runtime_writer_lock import RuntimeWriterLock
from src.A_memorix.core.runtime.services.vector_rebuild_checkpoint import VectorRebuildCheckpoint


def main():
    data = ROOT / 'work/instance/data/a-memorix'
    lock = RuntimeWriterLock(data / '.a_memorix_runtime_writer.lock')
    lock.acquire()
    try:
        space_id = json.loads((data/'vectors/active.json').read_text())['space_id']
        space = data/'vectors/spaces'/space_id
        fingerprint = json.loads((space/'space.json').read_text())['embedding_fingerprint']
        assert fingerprint['source'] == 'observed' and fingerprint['dimension'] == 1024
        with closing(sqlite3.connect(data/'metadata/metadata.db')) as db:
            paragraphs = dict(db.execute('SELECT hash,content FROM paragraphs'))
        packages = [ROOT/'outputs/方源人格与资料库-0.2/04_验收与接入/方源资料研究版-0.2.0.amembundle',
                    next((ROOT/'work/research/originals').glob('*/*.amembundle'))]
        records, vectors = [], []
        for package in packages:
            with zipfile.ZipFile(package) as archive:
                manifest = json.loads(archive.read('manifest.json'))
                assert manifest['embedding_fingerprint']['hash'] == fingerprint['hash']
                docs = json.loads(archive.read('knowledge.json'))['docs']
                with np.load(BytesIO(archive.read('vectors/paragraphs.npz')), allow_pickle=False) as raw:
                    ids = raw['ids'].tolist()
                    block = raw['vectors'].copy()
                assert ids == [d['id'] for d in docs]
                for doc, vec in zip(docs, block, strict=True):
                    assert paragraphs[doc['id']].strip() == doc['passage'].strip(), doc['id']
                    assert vec.shape == (1024,) and np.isfinite(vec).all()
                    records.append((doc['id'], paragraphs[doc['id']].strip()))
                    vectors.append(vec)
        checkpoint_path = space/'rebuild_checkpoint.sqlite3'
        with closing(sqlite3.connect(checkpoint_path)) as prior:
            for model, pool, uid, _input, value in prior.execute('SELECT model,pool,id,input,vector FROM vectors LIMIT 32'):
                assert model == fingerprint['hash'] and pool == 'paragraph'
                idx = next(i for i, item in enumerate(records) if item[0] == uid)
                old, candidate = np.frombuffer(value, dtype=np.float32), vectors[idx]
                cosine = float(old @ candidate / max(float(np.linalg.norm(old)*np.linalg.norm(candidate)), 1e-12))
                assert cosine > .999, cosine
            backup_path = ROOT/'work/private/native-rebuild-checkpoint-before-seed.sqlite3'
            assert not backup_path.exists(), 'Preserve previous backup'
            with closing(sqlite3.connect(backup_path)) as backup:
                prior.backup(backup)
        checkpoint = VectorRebuildCheckpoint(checkpoint_path, fingerprint['hash'], 1024)
        for start in range(0, len(records), 256):
            checkpoint.write('paragraph', records[start:start+256], np.asarray(vectors[start:start+256]))
        print(json.dumps({'exact_paragraphs_validated':len(records), 'fingerprint_matched':True,
                          'sample_cosine_above':.999, 'checkpoint_seeded':True}))
    finally:
        lock.release()


if __name__ == '__main__':
    main()
