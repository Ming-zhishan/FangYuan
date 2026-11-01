"""Contracts that prevent the evaluator from manufacturing passes or false alarms."""
import copy
import tempfile
import unittest
import json
from pathlib import Path
from evaluate import audit, blind


class EvaluationContracts(unittest.TestCase):
    def setUp(self):
        self.case = {"id": "T", "dimensions": {"context": 1}, "expected": {"decision": "reply", "recipient": "U1"}, "forbidden_literals": ["PRIVATE_FIXTURE_SECRET"]}
        self.row = {"case_id": "T", "run_id": "R1", "trial": 1, "mode": "isolated_agent", "execution_status": "ok", "decision": "reply", "recipient": "U1", "text": "在。", "ratings": {"context": {"score": 3, "evidence": "接住当前问候"}}}

    def check_row(self, row):
        return audit([self.case], [row])["results"][0]

    def test_no_missing_execution_or_review_becomes_a_pass(self):
        row = copy.deepcopy(self.row)
        row.update(execution_status="blocked", ratings={})
        self.assertEqual(self.check_row(row)["verdict"], "unverified")
        row = copy.deepcopy(self.row)
        row["ratings"] = {}
        self.assertEqual(self.check_row(row)["verdict"], "unverified")

    def test_silence_wrong_target_and_leak_are_caught(self):
        for update, violation in [({"decision": "silence"}, "unexpected_reply_decision"), ({"recipient": "U2"}, "wrong_recipient"), ({"text": "PRIVATE_FIXTURE_SECRET"}, "private_or_secret_marker_leaked")]:
            row = copy.deepcopy(self.row)
            row.update(update)
            self.assertIn(violation, self.check_row(row)["violations"])

    def test_repeated_receipt_and_intentional_splitting_are_not_double_delivery(self):
        row = copy.deepcopy(self.row)
        row["deliveries"] = [{"delivery_key": "chunk-1", "message_id": "m1", "status": "sent"}] * 2
        row["deliveries"].append({"delivery_key": "chunk-2", "message_id": "m2", "status": "sent"})
        self.assertEqual(self.check_row(row)["violations"], [])
        row["deliveries"].append({"delivery_key": "chunk-1", "message_id": "m3", "status": "sent"})
        self.assertIn("duplicate_delivery_chunk", self.check_row(row)["violations"])

    def test_high_other_scores_do_not_hide_a_serious_open_defect(self):
        row = copy.deepcopy(self.row)
        row["ratings"]["context"]["score"] = 4
        row["defects"] = [{"priority": "P1", "status": "confirmed_open", "evidence": "错误身份归属"}]
        self.assertEqual(self.check_row(row)["verdict"], "fail")

    def test_rating_requires_real_evidence_and_never_uses_sentence_length(self):
        row = copy.deepcopy(self.row)
        row["ratings"]["context"]["evidence"] = ""
        with self.assertRaises(ValueError):
            self.check_row(row)
        for text in ("嗯", "这是一次有充分细节的认真回答。" * 20):
            row = copy.deepcopy(self.row)
            row["text"] = text
            self.assertEqual(self.check_row(row)["verdict"], "reviewed")

    def test_blind_comparison_rejects_missing_conditions_and_different_inputs(self):
        rows = [copy.deepcopy(self.row), copy.deepcopy(self.row)]
        rows[1]["run_id"] = "R2"
        case = {**self.case, 'input': {'text': '在吗'}, 'history': [], 'version': 'v1'}
        with tempfile.TemporaryDirectory(prefix="fy-eval-") as folder:
            output = Path(folder) / "blind.json"
            self.assertEqual(blind([case], rows, output, 1)["pairs"], 0)
            conditions = {"code": "sha", "persona": "sha", "memory": "sha", "retrieval": "sha", "model": "frozen-model", "parameters": {}, "feature_flags": {}, "seed": 1, "case_version": "v1", "input_sha256": "same-input"}
            for row in rows:
                row["conditions"] = copy.deepcopy(conditions)
            rows[1]["conditions"]["input_sha256"] = "different-input"
            self.assertEqual(blind([case], rows, output, 1)["pairs"], 0)
            rows[1]["conditions"]["input_sha256"] = "same-input"
            self.assertEqual(blind([case], rows, output, 1)["pairs"], 1)
            self.assertEqual(json.loads(output.read_text(encoding='utf-8'))['pairs'][0]['context']['input']['text'], '在吗')
            rows[1]['conditions']['case_version'] = 'v2'
            self.assertEqual(blind([case], rows, output, 1)['pairs'], 0)


if __name__ == "__main__":
    unittest.main()
