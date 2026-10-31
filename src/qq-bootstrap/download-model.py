"""Resume and verify Qwen's official GGUF download using bounded range requests."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import time
import httpx

ROOT = Path(__file__).resolve().parents[2]
DESTINATION = ROOT / "work/model-source"
PARTS = DESTINATION / "parts"
SIZE = 2497280256
CHUNK = 32 * 1024 * 1024
SHA256 = "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5"
URL = "https://modelscope.cn/models/Qwen/Qwen3-4B-GGUF/resolve/master/Qwen3-4B-Q4_K_M.gguf"


def download(index):
    start = index * CHUNK
    end = min(SIZE, start + CHUNK) - 1
    path = PARTS / f"{index:04d}.part"
    for attempt in range(6):
        offset = path.stat().st_size if path.exists() else 0
        if offset == end - start + 1:
            return index
        if offset > end - start + 1:
            raise ValueError("Invalid partial download length")
        try:
            with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(45, connect=20)) as client:
                headers = {"Range": f"bytes={start + offset}-{end}", "Accept-Encoding": "identity"}
                with client.stream("GET", URL, headers=headers) as response:
                    response.raise_for_status()
                    expected = f"bytes {start + offset}-{end}/{SIZE}"
                    if response.status_code != 206 or response.headers.get("content-range") != expected:
                        raise ValueError("Server did not honor the requested byte range")
                    with path.open("ab") as target:
                        for data in response.iter_bytes(256 * 1024):
                            target.write(data)
            if path.stat().st_size == end - start + 1:
                print(f"Part {index + 1} verified by length", flush=True)
                return index
        except (httpx.HTTPError, OSError):
            if attempt == 5:
                raise
            time.sleep(min(2 ** attempt, 10))
    raise RuntimeError("Incomplete download")


if __name__ == "__main__":
    PARTS.mkdir(parents=True, exist_ok=True)
    count = (SIZE + CHUNK - 1) // CHUNK
    # Reuse the contiguous prefix already downloaded by the single connection.
    prefix = DESTINATION / "Qwen3-4B-Q4_K_M.gguf.download"
    if prefix.exists():
        with prefix.open("rb") as source:
            for index in range(count):
                data = source.read(CHUNK)
                if not data:
                    break
                path = PARTS / f"{index:04d}.part"
                if not path.exists():
                    path.write_bytes(data)
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(download, range(count)))
    temporary = DESTINATION / "verified-model.tmp"
    digest = hashlib.sha256()
    with temporary.open("wb") as target:
        for index in range(count):
            with (PARTS / f"{index:04d}.part").open("rb") as source:
                while data := source.read(8 * 1024 * 1024):
                    digest.update(data)
                    target.write(data)
    if temporary.stat().st_size != SIZE or digest.hexdigest() != SHA256:
        raise RuntimeError("Official model SHA256 verification failed")
    temporary.replace(DESTINATION / "Qwen3-4B-Q4_K_M.gguf")
    print("Official model size and SHA256 verified", flush=True)
