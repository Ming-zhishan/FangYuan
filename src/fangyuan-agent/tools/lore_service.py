"""Local read-only semantic retrieval of the existing, fingerprinted user original index."""
from __future__ import annotations
import argparse
import functools
import json
from pathlib import Path
import re
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request
import numpy as np


class Index:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.path = self.folder / 'fulltext.sqlite3'
        self.vectors = np.load(self.folder / 'fulltext-vectors.npy', mmap_mode='r', allow_pickle=False)
        with self.connection() as db:
            self.rows = db.execute('SELECT id,sequence,volume,number_text,title,part,passage,source_label,heading_line FROM chunks ORDER BY rowid').fetchall()
        if len(self.rows) != self.vectors.shape[0] or self.vectors.shape[1] != 1024 or not np.isfinite(self.vectors[:20]).all():
            raise ValueError('Original vectors/database mismatch')
        self.lock = threading.Lock()

    def connection(self):
        db = sqlite3.connect(self.path.resolve().as_uri() + '?mode=ro', uri=True)
        db.execute('PRAGMA query_only=ON')
        return db

    @functools.lru_cache(maxsize=128)
    def search(self, query):
        query = query.strip()[:300]
        if not query:
            return []
        with self.lock:
            request = urllib.request.Request('http://127.0.0.1:11434/api/embed', data=json.dumps({'model': 'qwen3-embedding:0.6b', 'input': query, 'keep_alive': '30m', 'options': {'num_gpu': 0}}).encode(), headers={'Content-Type': 'application/json'})
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(request, timeout=35) as response:
                vector = np.asarray(json.load(response)['embeddings'][0], dtype=np.float32)
            if vector.shape != (1024,) or not np.isfinite(vector).all():
                raise ValueError('Embedding dimensions/values invalid')
            vector /= max(float(np.linalg.norm(vector)), 1e-12)
            scores = self.vectors @ vector
        # Exact rare names and relationship terms complement similarity; do not hardwire a single benefactor.
        keys = re.findall(r'[\u4e00-\u9fff]{2,}', query)
        pairs = {p[i:i+2] for p in keys for i in range(len(p)-1)} - {'你的', '是谁', '什么', '为什', '什么', '怎么', '原著', '原文', '告诉', '一下', '方源'}
        candidates = np.argsort(scores)[::-1][:80]
        ranked = sorted(candidates, key=lambda i: float(scores[i]) + min(.10, sum(k in self.rows[i][6] for k in pairs) * .012), reverse=True)
        result, chapters = [], set()
        for i in ranked:
            if float(scores[i]) < .35:
                continue
            row = self.rows[int(i)]
            if row[1] in chapters and len(result) < 3:
                continue
            chapters.add(row[1])
            text = row[6]
            # The query can match a common header. Prefer the body after the information-boundary marker.
            body_at = text.find('\n\n')
            body_at = body_at + 2 if body_at >= 0 else 0
            offsets = [text.find(k, body_at) for k in pairs if text.find(k, body_at) >= 0]
            start = max(body_at, (min(offsets) if offsets else body_at) - 180)
            result.append({'id': 'original:' + row[0], 'kind': 'original_semantic_excerpt', 'score': round(float(scores[i]), 4), 'sequence': row[1], 'volume': row[2], 'chapter': row[3], 'title': row[4], 'part': row[5], 'source': row[7], 'headingLine': row[8], 'text': text[start:start+1100]})
            if len(result) == 4:
                break
        return result


def handler(index):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, value):
            data = json.dumps(value, ensure_ascii=False).encode('utf-8')
            self.send_response(status); self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)

        def do_GET(self):
            if self.path == '/health':
                self.reply(200, {'ok': True, 'service': 'fangyuan-original-readonly', 'chunks': len(index.rows), 'dimensions': 1024, 'semanticReviewComplete': False})
            else:
                self.reply(404, {'ok': False})

        def do_POST(self):
            if self.path != '/search':
                self.reply(404, {'ok': False}); return
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 6000:
                self.reply(413, {'ok': False}); return
            try:
                body = json.loads(self.rfile.read(length))
                query = body.get('query')
                if not isinstance(query, str) or len(query) > 300:
                    raise ValueError('Invalid query')
                self.reply(200, {'ok': True, 'items': index.search(query)})
            except Exception as error:
                self.reply(503, {'ok': False, 'error': type(error).__name__, 'note': 'Semantic retrieval unavailable; this does not prove absence in original'})
    return Handler


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--folder', required=True)
    parser.add_argument('--port', type=int, default=38494)
    args = parser.parse_args()
    ThreadingHTTPServer(('127.0.0.1', args.port), handler(Index(args.folder))).serve_forever()
