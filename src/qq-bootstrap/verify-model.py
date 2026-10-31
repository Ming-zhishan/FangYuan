"""Live local inference and tool-call compatibility check using synthetic input."""
from pathlib import Path
import json
import time
import tomllib
import httpx

ROOT = Path(__file__).resolve().parents[2]
bot = tomllib.loads((ROOT / "work/instance/config/bot_config.toml").read_text(encoding="utf-8"))
persona = bot["personality"]
system = "\n".join(persona[key] for key in ("personality", "behavior_style", "reply_style"))
with httpx.Client(base_url="http://127.0.0.1:11434", trust_env=False, timeout=180) as client:
    show = client.post("/api/show", json={"model": "fangyuan-qwen:latest"})
    show.raise_for_status()
    started = time.monotonic()
    response = client.post("/v1/chat/completions", json={
        "model": "fangyuan-qwen:latest", "reasoning_effort": "none", "max_tokens": 160,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": "复习了半天，感觉什么都没记住。"}],
    })
    response.raise_for_status()
    chat = response.json()
    content = chat["choices"][0]["message"].get("content", "")
    assert content.strip(), "Local model did not return a reply"
    assert "<think>" not in content, "Thinking text appeared in the user reply"
    assert chat["choices"][0].get("finish_reason") == "stop", "Reply was truncated before it finished"
    assert len(content) <= 200, "Reply is too long for the configured group persona"
    assert not any(text in content for text in ("我需要以", "用户现在", "首先，要体现")), "Internal analysis appeared as the reply"
    elapsed = round(time.monotonic() - started, 2)
    response = client.post("/v1/chat/completions", json={
        "model": "fangyuan-qwen:latest", "reasoning_effort": "none", "max_tokens": 160,
        "messages": [{"role": "user", "content": "请调用 get_weather 查询上海天气，不要直接回答。"}],
        "tools": [{"type": "function", "function": {"name": "get_weather", "description": "查询指定城市的天气", "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}}],
    })
    response.raise_for_status()
    calls = response.json()["choices"][0]["message"].get("tool_calls", [])
    assert calls and calls[0]["function"]["name"] == "get_weather", "Tool-call compatibility check failed"
    loaded = client.get("/api/ps").json().get("models", [])
    result = {
        "live_local_chat": "PASS", "tool_call_protocol": "PASS",
        "sample_reply": content, "first_reply_seconds_including_load": elapsed,
        "capabilities": show.json().get("capabilities", []),
        "loaded_models": [{key: item.get(key) for key in ("name", "size", "size_vram", "context_length")} for item in loaded],
    }
    (ROOT / "work/logs/model-verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=True))
