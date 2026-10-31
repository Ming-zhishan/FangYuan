"""Verify MaiBot's actual embedding adapter using isolated synthetic reference facts."""
from pathlib import Path
import asyncio
import json
import os
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
os.environ["MAIBOT_INSTANCE_DIR"] = str(ROOT / "work/instance")

from src.config.config import config_manager

config_manager.initialize()
from src.A_memorix.core.embedding.api_adapter import EmbeddingAPIAdapter


async def main():
    config = config_manager.get_global_config().a_memorix.embedding
    adapter = EmbeddingAPIAdapter(
        batch_size=4, max_concurrent=1, default_dimension=config.dimension,
        model_name=config.model_name, dimension_request_mode=config.dimension_request_mode,
        retry_config={"max_attempts": 1},
    )
    # Intentionally fictional; never write this test data to the character library.
    documents = [
        "检索测试条目：旅行者甲讨厌甜食，饮茶时从不添加糖。",
        "检索测试条目：旅店乙位于河流东岸，每星期二停止营业。",
        "检索测试条目：铁匠丙擅长修理长剑，店铺墙上悬挂红色旗帜。",
    ]
    queries = ["旅行者甲喝茶要加糖吗？", "旅店乙星期几休息？", "哪里可以找人修剑？"]
    started = time.monotonic()
    vectors = np.asarray(await adapter.encode(documents + queries), dtype=np.float32)
    assert vectors.shape == (6, 1024), vectors.shape
    assert np.isfinite(vectors).all()
    vectors /= np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)
    similarities = vectors[3:] @ vectors[:3].T
    matches = similarities.argmax(axis=1).tolist()
    assert matches == [0, 1, 2], {"matches": matches, "scores": similarities.tolist()}
    result = {
        "passed": True, "scope": "MaiBot embedding adapter and synthetic semantic ranking",
        "model": "qwen3-embedding:0.6b", "dimension": 1024,
        "correct_matches": 3, "total_queries": 3,
        "seconds": round(time.monotonic() - started, 2),
        "production_materials_imported": False, "group_reply_tested": False,
    }
    (ROOT / "work/logs/knowledge-verification.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
