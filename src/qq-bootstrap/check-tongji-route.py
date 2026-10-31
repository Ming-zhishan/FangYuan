"""同济 agi 固定映射的检测与维护。

背景：Clash 开启 TUN 时，agi.tongji.edu.cn 会被 fake-ip 接管并解析到公网入口
202.120.188.x，学校 WAF 判为校外网络返回 403。因此在 Clash 的 hosts 里把该域名
固定到校内入口 10.67.x。

本工具处理三种失效场景：
  1. 学校更换内网入口地址
  2. Clash 订阅更新后生成的配置丢失 hosts 映射
  3. 离开校园网后固定 IP 不可达

默认只检测不改动。加 --fix 才会改写 Clash 配置并重载内核。
"""
import argparse
import json
import socket
import struct
import sys
from pathlib import Path

CONF = Path.home() / 'AppData/Roaming/io.github.clash-verge-rev.clash-verge-rev'
RUNTIME = CONF / 'clash-verge.yaml'
MERGE = CONF / 'profiles/Merge.yaml'
PIPE = r'\\.\pipe\verge-mihomo'
SECRET = 'set-your-secret'
SCHOOL_DNS = ('202.120.190.208', '202.120.190.108')
HOST = 'agi.tongji.edu.cn'


def _build(name):
    head = struct.pack('>HHHHHH', 0x5A5A, 0x0100, 1, 0, 0, 0)
    q = b''.join(bytes([len(p)]) + p.encode() for p in name.split('.')) + b'\x00'
    return head + q + struct.pack('>HH', 1, 1)


def _parse(data):
    an = struct.unpack('>H', data[6:8])[0]
    i = 12
    while data[i] != 0:
        i += 1 + data[i]
    i += 5
    out = []
    for _ in range(an):
        if data[i] & 0xC0 == 0xC0:
            i += 2
        else:
            while data[i] != 0:
                i += 1 + data[i]
            i += 1
        typ, _cls, _ttl, rdl = struct.unpack('>HHIH', data[i:i + 10])
        i += 10
        rd = data[i:i + rdl]
        i += rdl
        if typ == 1 and rdl == 4:
            out.append('.'.join(map(str, rd)))
    return out


def school_resolve(server, name=HOST, timeout=5):
    """直接问校内 DNS。TUN 开启时查询会被 fake-ip 劫持，靠返回网段判断真伪。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        s.sendto(_build(name), (server, 53))
        data, _ = s.recvfrom(2048)
        return _parse(data)
    finally:
        s.close()


def read_hosts_map():
    """只在顶层 hosts: 段里找，避免误命中 nameserver-policy 下的同名 key。"""
    in_hosts = False
    for line in RUNTIME.read_text(encoding='utf-8').splitlines():
        if line.startswith('hosts:'):
            in_hosts = True
            continue
        if not in_hosts:
            continue
        if line.strip() and not line.startswith((' ', '\t')):
            break
        stripped = line.strip()
        if stripped.startswith(HOST + ':'):
            value = stripped.split(':', 1)[1].strip()
            if value:
                return value
    return None


def probe(ip=None):
    """请求 /v1/models，只读、不生成、不扣积分。"""
    import httpx
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import tongji_provider as school
    cfg = school.settings()
    key = school.credential()
    orig = socket.getaddrinfo
    if ip:
        socket.getaddrinfo = lambda h, p, *a, **k: orig(ip, p, *a, **k) if h == HOST else orig(h, p, *a, **k)
    try:
        with httpx.Client(trust_env=False, timeout=12) as c:
            r = c.get(school.endpoint(cfg) + '/models', headers={'Authorization': 'Bearer ' + key})
        return {'status': r.status_code, 'ok': r.status_code == 200}
    except Exception as exc:
        return {'status': None, 'ok': False, 'error': type(exc).__name__}
    finally:
        socket.getaddrinfo = orig


def inner_ips():
    for srv in SCHOOL_DNS:
        try:
            ips = [ip for ip in school_resolve(srv) if ip.startswith(('10.', '172.', '192.168.'))]
            if ips:
                return ips
        except Exception:
            continue
    return []


def apply_fix(ip):
    """只替换 hosts 里的那一行，其余配置原样保留。"""
    for path in (RUNTIME, MERGE):
        if not path.exists():
            continue
        text = path.read_text(encoding='utf-8')
        lines = text.splitlines()
        hit = False
        for i, line in enumerate(lines):
            if line.strip().startswith(HOST + ':'):
                lines[i] = '  %s: %s' % (HOST, ip)
                hit = True
        if not hit:
            anchor = next((i for i, l in enumerate(lines) if l.strip() == 'tun:'), None)
            block = ['hosts:', '  %s: %s' % (HOST, ip), '']
            if anchor is None:
                lines += block
            else:
                lines[anchor:anchor] = block
        path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    reload_core()


def reload_core():
    """mihomo 只认 payload；传 path 会返回 204 但不生效（实测）。"""
    body = json.dumps({'payload': RUNTIME.read_text(encoding='utf-8')}).encode()
    head = ('PUT /configs HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer %s\r\n'
            'Content-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n'
            % (SECRET, len(body))).encode()
    f = open(PIPE, 'r+b', buffering=0)
    f.write(head + body)
    status = f.read(512).decode('utf-8', 'replace').split('\r\n')[0]
    f.close()
    return status


def main():
    ap = argparse.ArgumentParser(description='检查或修复同济 agi 固定映射')
    ap.add_argument('--fix', action='store_true', help='按校内 DNS 结果改写配置并重载')
    args = ap.parse_args()

    current = read_hosts_map()
    live = inner_ips()
    result = {'configured_ip': current, 'school_dns_inner_ips': live,
              'configured_probe': probe(current) if current else None}

    if args.fix:
        target = live[0] if live else None
        if not target:
            result['fix'] = 'skipped: 无法从校内 DNS 取到内网地址，可能不在校园网'
        elif target == current:
            result['fix'] = 'no change: 已指向 %s' % target
        else:
            apply_fix(target)
            result['fix'] = 'updated %s -> %s' % (current, target)
            result['after_probe'] = probe(target)
    else:
        p = result['configured_probe'] or {}
        if p.get('ok'):
            result['verdict'] = 'ok: 固定映射可用'
        elif not current:
            result['verdict'] = 'missing: Clash 配置里没有该域名映射，可运行 --fix'
        elif live and current not in live:
            result['verdict'] = 'stale: 校内入口已变为 %s，可运行 --fix' % ','.join(live)
        else:
            result['verdict'] = 'unreachable: 当前网络可能不在校园网，或入口已变更'

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
