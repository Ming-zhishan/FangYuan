"""Zero-network synthetic evaluator loop. This does not execute the Bot."""
import json
from evaluate import ROOT, rows, validate, audit

cases = rows(ROOT / 'data/cases.v1.jsonl')
assert not validate(cases)
result = audit(cases, rows(ROOT / 'examples/synthetic-results.jsonl'))
by_id = {r['case_id']: r for r in result['results']}
assert by_id['SYN-001']['verdict'] == 'reviewed'
assert 'wrong_recipient' in by_id['SYN-003']['violations']
assert by_id['SYN-006']['verdict'] == 'reviewed'
assert 'private_or_secret_marker_leaked' in by_id['SYN-009']['violations']
assert by_id['SYN-005']['verdict'] == 'unverified'
print(json.dumps({'smoke': 'pass', 'fixture_observations': 5, 'counts': result['counts'], 'model_calls': 0, 'qq_sent': 0, 'scope': 'synthetic evaluator contracts; no Bot quality acceptance'}))
