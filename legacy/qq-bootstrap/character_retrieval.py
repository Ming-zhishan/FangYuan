"""Prioritize the small reviewed library before appending full-text native hits."""
import asyncio
from contextlib import closing
from pathlib import Path
import re
import sqlite3

import httpx
import numpy as np

ROOT = Path(__file__).resolve().parents[2]


class ReviewedRetrieval:
    def __init__(self,cpu=False):
        self.cpu=cpu
        with np.load(ROOT/'work/research/runtime-index-v2.npz', allow_pickle=False) as data:
            self.ids = data['entry_ids'].tolist()
            self.vectors = data['vectors'].copy()
        folder = ROOT/'outputs/方源人格与资料库-0.2/04_验收与接入/导入材料'
        self.texts = [(folder/(uid+'.md')).read_text(encoding='utf-8') for uid in self.ids]
        self.semaphore = asyncio.Semaphore(1)
        folders=list((ROOT/'work/research/originals').glob('*/fulltext-vectors.npy'))
        self.original_vectors=np.load(folders[0],mmap_mode='r') if len(folders)==1 else None
        self.original_database=folders[0].parent/'fulltext.sqlite3' if len(folders)==1 else None

    @staticmethod
    def relevant(query):
        if re.fullmatch(r'[\s你好在吗哈，,。！？!?]*方源[\s你好在吗哈，,。！？!?]*',query):
            return False
        return bool(re.search(r'(?:你|方源).{0,5}(?:实力|修为|境界|几转)|原著|方源|三王|蛊|影宗|人祖|白凝冰|永生|成尊|尊者|商心慈|太白云生|黑楼兰|方正|紫山|红莲|无极|元始|元莲|盗天|狂蛮|巨阳|星宿|幽魂|乐土|凤九歌|谢晗沫|武庸|天庭|长生天|义天山|青茅|疯魔窟|宿命|炼道', query))

    async def search(self, query, limit=2):
        if not self.relevant(query):
            return []
        if re.search(r'(?:你|方源).{0,5}(?:实力|修为|境界|几转)',query):
            return [{'id':uid,'score':None,'content':self.texts[self.ids.index(uid)]} for uid in ['H12','W07'][:limit]]
        if re.search(r'仙蛊唯一',query):
            return [{'id':'W02','score':None,'content':self.texts[self.ids.index('W02')]}]
        # Resolve a frequent stage-dependent ambiguity, rather than merging all仙蛊.
        if re.search(r'早期|少年|一转|学堂', query) and re.search(r'仙蛊|春秋蝉', query) and not re.search(r'定仙游|第二空窍', query):
            return [{'id':uid, 'score':None, 'content':self.texts[self.ids.index(uid)]}
                    for uid in ['D02','H02'][:limit]]
        async with self.semaphore:
            async with httpx.AsyncClient(base_url='http://127.0.0.1:11434', trust_env=False, timeout=40) as client:
                if self.cpu:
                    response=await client.post('/api/embed',json={'model':'qwen3-embedding:0.6b','input':query,'keep_alive':'30m','options':{'num_gpu':0}})
                else:
                    response = await client.post('/v1/embeddings', json={'model':'qwen3-embedding:0.6b', 'input':query})
                response.raise_for_status()
                payload=response.json()
                vector = np.asarray(payload['embeddings'][0] if self.cpu else payload['data'][0]['embedding'], dtype=np.float32)
        assert vector.shape == (self.vectors.shape[1],)
        vector /= max(float(np.linalg.norm(vector)), 1e-12)
        scores = self.vectors @ vector
        hits=[{'id':self.ids[i], 'score':float(scores[i]), 'content':self.texts[i]}
                for i in np.argsort(scores)[::-1][:limit] if scores[i] >= .4]
        if self.original_vectors is not None and (not hits or scores.max()<.58 or re.search(r'原文|章节|详细|经过|第.{0,10}[章节]',query)):
            original_scores=self.original_vectors@vector
            i=int(np.argmax(original_scores))
            if original_scores[i]>=.4:
                with closing(sqlite3.connect('file:'+self.original_database.resolve().as_posix()+'?mode=ro',uri=True)) as db:
                    row=db.execute('SELECT id,passage FROM chunks ORDER BY rowid LIMIT 1 OFFSET ?',(i,)).fetchone()
                if row:
                    hits.append({'id':'original:'+row[0], 'score':float(original_scores[i]),'content':row[1]})
        return hits
