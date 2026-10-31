"""Enable local, static character knowledge without changing the existing persona."""
from pathlib import Path
import json
import shutil

import httpx
import tomlkit

ROOT = Path(__file__).resolve().parents[2]
INSTANCE = ROOT / "work/instance"
PRIVATE = ROOT / "work/private"
MODEL = "qwen3-embedding:0.6b"
NAME = "fangyuan-embedding"


def configure():
    with httpx.Client(base_url="http://127.0.0.1:11434", trust_env=False, timeout=15) as client:
        response = client.get("/api/tags")
        response.raise_for_status()
        if MODEL not in {item["name"] for item in response.json()["models"]}:
            raise RuntimeError("The local embedding model must finish downloading first.")
    marker = PRIVATE / "knowledge-configured.json"
    if marker.exists():
        print(json.dumps({"knowledge_configured": True, "already_configured": True}))
        return
    bot_path = INSTANCE / "config/bot_config.toml"
    model_path = INSTANCE / "config/model_config.toml"
    backup = PRIVATE / "before-knowledge"
    backup.mkdir(exist_ok=True)
    for path in (bot_path, model_path):
        if not (backup / path.name).exists():
            shutil.copy2(path, backup / path.name)

    model = tomlkit.parse(model_path.read_text(encoding="utf-8"))
    if not any(item["name"] == NAME for item in model["models"]):
        model["models"].append({
            "model_type": "embedding", "model_identifier": MODEL,
            "name": NAME, "api_provider": "Ollama-Local",
            "price_in": 0.0, "price_out": 0.0,
            "extra_params": {},
        })
    model["model_task_config"]["embedding"]["model_list"] = [NAME]
    model["model_task_config"]["embedding"]["hard_timeout"] = 180.0
    model["model_task_config"]["memory"].update(
        model_list=["fangyuan-local"], max_tokens=4096,
    )

    bot = tomlkit.parse(bot_path.read_text(encoding="utf-8"))
    kb = bot["a_memorix"]
    kb["plugin"]["enabled"] = True
    kb["embedding"].update(
        model_name=NAME, dimension=1024, dimension_request_mode="never",
        batch_size=4, max_concurrent=1, enable_cache=True,
    )
    kb["filter"].update(enabled=True, mode="whitelist", chats=["group:680823437"])
    kb["integration"].update(
        enable_memory_query_tool=True, memory_query_default_limit=3,
        enable_person_profile_query_tool=False, enable_person_profile_injection=False,
        person_fact_writeback_enabled=False, chat_summary_writeback_enabled=False,
        heuristic_memory_recall_enabled=False,
        fuzzy_modify_enabled=False, fuzzy_modify_auto_execute_enabled=False,
    )
    # This instance uses reference lore only; do not autonomously rewrite/forget it.
    kb["memory"]["enabled"] = False
    kb["episode"].update(enabled=False, generation_enabled=False)
    kb["person_profile"]["enabled"] = False
    kb["image_memory"]["enabled"] = False
    bot_path.write_text(tomlkit.dumps(bot), encoding="utf-8")
    model_path.write_text(tomlkit.dumps(model), encoding="utf-8")
    marker.write_text(json.dumps({
        "mode": "local-static-reference", "model": MODEL, "dimension": 1024,
        "group": "680823437", "materials_imported": False,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"knowledge_configured": True, "materials_imported": False}))


if __name__ == "__main__":
    configure()
