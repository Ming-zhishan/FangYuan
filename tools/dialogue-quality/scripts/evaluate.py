"""Offline evaluation of saved outputs. No model, QQ, HTTP, or database interface."""
import argparse
import hashlib
import json
import random
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIMENSIONS = {"persona", "naturalness", "context", "memory", "culture", "canon", "timing", "social", "output"}
MODES = {"static_archive", "offline_rules", "model_only", "isolated_agent", "qq_authorized"}
CONDITIONS = {"code", "persona", "memory", "retrieval", "model", "parameters", "feature_flags", "seed"}
IDENTICAL_INPUTS = {"case_version", "input_sha256"}


def rows(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def save(path, data):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate(cases):
    seen, errors = set(), []
    required = {"id", "category", "risk", "purpose", "history", "input", "participants", "expected", "forbidden", "dimensions", "dependencies", "provenance", "version"}
    for case in cases:
        ident = case.get("id", "<missing>")
        if ident in seen:
            errors.append(f"{ident}: duplicate ID")
        seen.add(ident)
        if required - case.keys():
            errors.append(f"{ident}: missing {sorted(required - case.keys())}")
        if not set(case.get("dimensions", {})) <= DIMENSIONS or not case.get("dimensions"):
            errors.append(f"{ident}: invalid dimensions")
        if case.get("expected", {}).get("decision") not in {"reply", "silence", "either"}:
            errors.append(f"{ident}: expected decision missing")
        if not case.get("history") and case.get("category") in {"C", "D", "H"}:
            errors.append(f"{ident}: multi-turn category needs history")
        for weight in case.get("dimensions", {}).values():
            if not isinstance(weight, (int, float)) or weight <= 0:
                errors.append(f"{ident}: weights must be positive")
    return errors


def audit(cases, results):
    index, audited, seen = {c["id"]: c for c in cases}, [], set()
    for result in results:
        ident = result.get("case_id")
        if ident not in index:
            raise ValueError(f"unknown case: {ident}")
        case = index[ident]
        key = (ident, result.get("run_id"), result.get("trial"))
        if key in seen:
            raise ValueError(f"duplicate observation: {key}")
        seen.add(key)
        if result.get("mode") not in MODES:
            raise ValueError(f"{ident}: explicit execution mode required")
        violations, missing = [], []
        if result.get("execution_status") != "ok":
            missing.append("execution incomplete: quality not scored")
        else:
            decision = result.get("decision")
            if decision not in {"reply", "silence"}:
                missing.append("decision not observed")
            elif case["expected"]["decision"] != "either" and decision != case["expected"]["decision"]:
                violations.append("unexpected_reply_decision")
            text = result.get("text", "")
            if decision == "reply" and not text.strip():
                violations.append("empty_reply")
            for marker in case.get("forbidden_literals", []):
                if marker in text:
                    violations.append("private_or_secret_marker_leaked")
            target = case["expected"].get("recipient")
            if decision == "reply" and target:
                if not result.get("recipient"):
                    missing.append("recipient not observed")
                elif result["recipient"] != target:
                    violations.append("wrong_recipient")
            deliveries = [x for x in result.get("deliveries", []) if x.get("status") == "sent"]
            by_chunk = {}
            for delivery in deliveries:
                if delivery.get("delivery_key") and delivery.get("message_id"):
                    by_chunk.setdefault(delivery["delivery_key"], set()).add(delivery["message_id"])
            if any(len(receipts) > 1 for receipts in by_chunk.values()):
                violations.append("duplicate_delivery_chunk")
        ratings = result.get("ratings", {})
        for dimension, rating in ratings.items():
            if dimension not in case["dimensions"]:
                raise ValueError(f"{ident}: rating outside applicable dimensions: {dimension}")
            score = rating.get("score")
            if isinstance(score, bool) or not isinstance(score, int) or not 0 <= score <= 4 or not rating.get("evidence"):
                raise ValueError(f"{ident}: rating needs integer 0-4 and evidence")
        applicable = set(case["dimensions"])
        if applicable - ratings.keys():
            missing.append("unreviewed: " + ",".join(sorted(applicable - ratings.keys())))
        if result.get("execution_status") != "ok" and ratings:
            raise ValueError(f"{ident}: incomplete execution cannot have quality scores")
        weighted = None
        if ratings and applicable == ratings.keys():
            weighted = round(sum(ratings[d]["score"] * case["dimensions"][d] for d in applicable) / sum(case["dimensions"].values()), 3)
        quality_issues = [d for d, rating in ratings.items() if rating["score"] < 3]
        critical = [d for d in result.get("defects", []) if d.get("priority") in {"P0", "P1"} and d.get("status") == "confirmed_open"]
        audited.append({"case_id": ident, "run_id": result.get("run_id"), "trial": result.get("trial"),
                        "mode": result["mode"], "violations": violations, "missing": missing,
                        "weighted_score": weighted, "ratings": ratings, "below_scene_requirement": quality_issues,
                        "critical_open": critical,
                        "verdict": "fail" if violations or quality_issues or critical else "unverified" if missing else "reviewed"})
    return {"results": audited, "counts": dict(Counter(x["verdict"] for x in audited)),
            "cases_without_observations": sorted(set(index) - {r["case_id"] for r in results}),
            "limit": "Rule checks and evidence-backed text review do not constitute live Agent or human acceptance."}


def blind(cases, results, output, seed):
    grouped, pairs, keys, excluded = {}, [], [], []
    case_index = {c['id']: c for c in cases}
    for r in results:
        grouped.setdefault((r.get("case_id"), r.get("trial")), []).append(r)
    rng = random.Random(seed)
    for key, group in sorted(grouped.items()):
        case = case_index.get(key[0])
        if not case or not case.get('input') or not case.get('version'):
            excluded.append({'case_trial': key, 'reason': 'review context or case version missing'})
            continue
        if len(group) != 2:
            excluded.append({"case_trial": key, "reason": "exactly two observations required"})
            continue
        required = CONDITIONS | IDENTICAL_INPUTS
        if any(r.get("execution_status") != "ok" or not required <= r.get("conditions", {}).keys() or any(r["conditions"][k] is None or r["conditions"][k] in ("unknown", "unverified") for k in required) for r in group):
            excluded.append({"case_trial": key, "reason": "missing frozen conditions or incomplete execution"})
            continue
        if any(group[0]["conditions"][k] != group[1]["conditions"][k] for k in IDENTICAL_INPUTS):
            excluded.append({"case_trial": key, "reason": "different case version or actual input"})
            continue
        if group[0]['conditions']['case_version'] != case['version']:
            excluded.append({'case_trial': key, 'reason': 'case snapshot does not match result version'})
            continue
        rng.shuffle(group)
        changes = sorted(k for k in CONDITIONS if group[0]["conditions"][k] != group[1]["conditions"][k])
        pair_id = "PAIR-" + hashlib.sha256(repr(key).encode()).hexdigest()[:12]
        context = {k: case.get(k) for k in ('purpose', 'history', 'input', 'participants', 'expected', 'forbidden', 'known_facts', 'evidence_refs') if k in case}
        pairs.append({"pair_id": pair_id, "case_id": key[0], "trial": key[1], 'context': context, "A": group[0].get("text", ""), "B": group[1].get("text", ""), "preference": None, "evidence": None})
        keys.append({"pair_id": pair_id, "A_run": group[0].get("run_id"), "B_run": group[1].get("run_id"), "changed_conditions": changes,
                     "comparison_scope": "single-condition" if len(changes) == 1 else "combined-change" if changes else "sampling-repeat"})
    save(output, {"pairs": pairs, "excluded": excluded})
    save(str(output) + ".key.private.json", {"pairs": keys, "seed": seed})
    return {"pairs": len(pairs), "excluded": len(excluded), "key_is_private": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["validate", "audit", "blind"])
    parser.add_argument("--cases", type=Path, default=ROOT / "data/cases.v1.jsonl")
    parser.add_argument("--results", type=Path)
    parser.add_argument("--out", type=Path, default=ROOT / "private/audit.json")
    parser.add_argument("--seed", type=int, default=20261101)
    args = parser.parse_args()
    cases = rows(args.cases)
    errors = validate(cases)
    if errors:
        print(json.dumps({"errors": errors}, ensure_ascii=False))
        return 2
    if args.command == "validate":
        print(json.dumps({"cases": len(cases), "categories": dict(Counter(c["category"] for c in cases)),
                          "dimensions": dict(Counter(d for c in cases for d in c["dimensions"])), "errors": []}, ensure_ascii=False))
        return 0
    if not args.results:
        parser.error("--results required")
    results = rows(args.results)
    if args.command == "blind":
        print(json.dumps(blind(cases, results, args.out, args.seed)))
        return 0
    result = audit(cases, results)
    save(args.out, result)
    print(json.dumps({"observations": len(results), "counts": result["counts"],
                      "without_observations": len(result["cases_without_observations"])}))
    return 1 if result["counts"].get("fail") else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(2)
