"""Verify persona evidence structure and optional read-only local passage fingerprints; no generation or writes."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
from contextlib import closing

DEFAULT = Path(__file__).resolve().parents[1] / 'data/persona-evidence.v1.json'

def verify(manifest, database=None):
    claims = manifest['claims']
    seen, refs = set(), {}
    for claim in claims:
        ident = claim['id']
        if ident in seen or not claim.get('claim') or not claim.get('bounds'):
            raise ValueError('Duplicate or incomplete claim')
        seen.add(ident)
        kind = claim['classification']
        if kind not in {'canon_supported', 'interaction_adaptation', 'user_customization'}:
            raise ValueError('Unknown evidence classification')
        if (kind == 'canon_supported') != bool(claim['references']):
            raise ValueError('Canon needs sources; adaptation must not pretend to be canon')
        for ref in claim['references']:
            key = ref['chunk_id']
            if len(key) != 64 or len(ref['passage_sha256']) != 64:
                raise ValueError('Missing passage fingerprint')
            if key in refs and refs[key] != ref:
                raise ValueError('Conflicting source metadata')
            refs[key] = ref
    checked = 0
    if database is not None:
        path = Path(database).resolve(strict=True)
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
            db.execute('PRAGMA query_only=ON')
            for key, ref in refs.items():
                row = db.execute('SELECT sequence,volume,number_text,part,passage FROM chunks WHERE id=?', (key,)).fetchone()
                if row is None or tuple(row[:4]) != tuple(ref[k] for k in ('sequence','volume','chapter_number','part')):
                    raise ValueError('Missing source or chapter metadata mismatch')
                if hashlib.sha256(row[4].encode('utf-8')).hexdigest() != ref['passage_sha256']:
                    raise ValueError('Passage content mismatch')
                checked += 1
    return {'claims': len(claims), 'unique_sources': len(refs), 'checked_sources': checked,
            'mode': 'read_only_fingerprint_check' if database else 'structure_only',
            'semantic_acceptance': 'not established by hashes; independent interpretation/calibration pending'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=DEFAULT)
    parser.add_argument('--db', type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(json.loads(args.manifest.read_text(encoding='utf-8-sig')), args.db), ensure_ascii=False))
    except (ValueError, KeyError, OSError, sqlite3.Error) as error:
        parser.exit(2, type(error).__name__ + ': evidence verification failed\n')
