"""Read local connection state; never print login credentials or API keys."""
import argparse
import asyncio
import hashlib
import json
import sys
import time
from pathlib import Path
import httpx
import websockets
import qrcode

ROOT = Path(__file__).resolve().parents[2]


def napcat_client():
    tokens = json.loads((ROOT / "work/private/connection.json").read_text(encoding="utf-8"))
    client = httpx.Client(base_url="http://127.0.0.1:6099/api", trust_env=False, timeout=10)
    digest = hashlib.sha256((tokens["napcat_web"] + ".napcat").encode()).hexdigest()
    login = client.post("/auth/login", json={"hash": digest}).json()
    if login.get("code") != 0:
        raise RuntimeError("Local NapCat authentication failed")
    client.headers["Authorization"] = "Bearer " + login["data"]["Credential"]
    return client


async def onebot_readonly():
    tokens = json.loads((ROOT / "work/private/connection.json").read_text(encoding="utf-8"))
    async with websockets.connect("ws://127.0.0.1:3001", additional_headers={"Authorization": "Bearer " + tokens["onebot"]}, open_timeout=5) as ws:
        results = {}
        for action in ("get_status", "get_login_info", "get_group_list"):
            await ws.send(json.dumps({"action": action, "params": {}, "echo": action}))
            while True:
                data = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                if data.get("echo") == action:
                    if data.get("status") != "ok":
                        raise RuntimeError("Local QQ read-only query failed")
                    results[action] = data["data"]
                    break
        qq = str(results["get_login_info"].get("user_id", ""))
        return {"qq": qq, "online": results["get_status"].get("online") is True,
                "correct_account": qq == "3816636861", "in_target_group": any(str(g.get("group_id")) == "680823437" for g in results["get_group_list"])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh-qr", action="store_true")
    parser.add_argument("--require-login", action="store_true")
    args = parser.parse_args()
    # The configured message socket is authoritative. An unrelated QQ instance
    # can own the WebUI port and show its own login QR while this bot is online.
    try:
        live = asyncio.run(onebot_readonly())
    except Exception:
        live = None
    if live and live.get('online'):
        result = {"qq_logged_in": bool(live['correct_account']),
                  "phase": "ready" if live['correct_account'] else "wrong_account",
                  "status_source": "configured_onebot", **live,
                  "model_mode": json.loads((ROOT/"work/private/cloud-runtime.json").read_text(encoding="utf-8")).get("mode","local"),
                  "agreements_confirmed": (ROOT/"work/instance/eula.confirmed").exists()}
        print(json.dumps(result, ensure_ascii=True))
        return 0 if live['correct_account'] else 2
    client = napcat_client()
    try:
        state = client.post("/QQLogin/CheckLoginStatus", json={}).json()["data"]
        ready = bool(state.get("isLogin") and live and live.get('online') and live.get('correct_account'))
        result = {"qq_logged_in": ready, "phase": state.get("loginPhase"), "model_mode": (json.loads((ROOT/"work/private/cloud-runtime.json").read_text(encoding="utf-8")).get("mode","local") if (ROOT/"work/private/cloud-runtime.json").exists() else "local"), "agreements_confirmed": (ROOT / "work/instance/eula.confirmed").exists()}
        if args.refresh_qr and not ready and state.get("loginPhase") not in {"qrcode_scanned", "initializing"}:
            old_url = state.get("qrcodeurl")
            response = client.post("/QQLogin/RefreshQRcode", json={}).json()
            if response.get("code") != 0:
                raise RuntimeError("Could not refresh the local QQ login QR code")
            # Refresh returns before QQ writes its image. Wait for the actual
            # new login URL instead of copying the previous expired PNG.
            for _ in range(20):
                state = client.post("/QQLogin/CheckLoginStatus", json={}).json()["data"]
                if state.get("qrcodeurl") and state.get("qrcodeurl") != old_url:
                    result["qr_refreshed"] = True
                    break
                time.sleep(0.2)
        if not ready and state.get("qrcodeurl"):
            url = state["qrcodeurl"]
            qr_id = hashlib.sha256(url.encode()).hexdigest()[:10]
            image = qrcode.make(url, box_size=10, border=4)
            temporary = ROOT / "work/private/qr-current.png"
            image.save(temporary)
            temporary.replace(ROOT / "outputs/QQ登录二维码.png")
            if args.refresh_qr:
                filename = f"QQ登录-{qr_id}.png"
                image.save(ROOT / "outputs" / filename)
                result["qr_file"] = filename
        if ready:
            result.update(asyncio.run(onebot_readonly()))
        print(json.dumps(result, ensure_ascii=True))
        if args.require_login and (not ready or not result.get("correct_account")):
            return 2
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(json.dumps({"error_type": type(exc).__name__, "ready": False}))
        sys.exit(1)
