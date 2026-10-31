"""Export reviewable persona fields; never change live configs or start a bot."""
from pathlib import Path
import hashlib
import json
import os
import sys

ROOT = Path(__file__).resolve().parents[2]
os.environ["MAIBOT_INSTANCE_DIR"] = str(ROOT / "work/instance")
sys.path.insert(0, str(ROOT / "work/research"))
from runtime_rules import BEHAVIOR, REPLY_STYLE, TAIL_RULES, runtime_persona
from src.config.official_configs import PersonalityConfig


def main():
    out = ROOT / "outputs/方源人格与资料库"
    text = (out / "01_核心人格/01_完整核心人格.md").read_text(encoding="utf-8")
    core = text.split("<!-- PERSONA_BEGIN -->", 1)[1].split("<!-- PERSONA_END -->", 1)[0].strip()
    persona = runtime_persona(core)
    candidate = {
        "status": "review_candidate_not_applied",
        "date": "2026-10-21",
        "notice": "本地模型关键验收失败。此文件只供审查，不可据此宣布部署完成。",
        "fields": {
            "personality": persona,
            "behavior_style": BEHAVIOR,
            "reply_style": REPLY_STYLE + "\n" + TAIL_RULES,
            "multiple_probability": 0,
        },
        "persona_sha256": hashlib.sha256(persona.encode()).hexdigest(),
        "owner_qq": None,
        "knowledge_bundle_installed": False,
        "group_reply_verified": False,
        "relationship_long_term_memory_enabled": False,
        "required_identity_control": "应用层按可信QQ账号映射身份；聊天自称不改变映射，不能只依赖人格提示词。",
    }
    PersonalityConfig.model_validate(candidate["fields"])
    candidate["installed_personality_schema_validated"] = True
    target = out / "04_验收与接入/人格字段草案.json"
    target.write_text(json.dumps(candidate, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"candidate_exported": True, "live_config_changed": False, "owner_bound": False}))


if __name__ == "__main__":
    main()
