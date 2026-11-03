import copy
import hashlib
from pathlib import Path
import sqlite3
import tempfile
import unittest
from verify_persona_sources import verify

class SourceIntegrity(unittest.TestCase):
    def setUp(self):
        self.ref = {'chunk_id':'a'*64,'sequence':1,'volume':1,'chapter_number':'one','part':1,
                    'passage_sha256':hashlib.sha256(b'synthetic passage').hexdigest()}
        self.data = {'claims':[{'id':'C','classification':'canon_supported','claim':'Synthetic claim',
                               'bounds':'Synthetic bounds','references':[self.ref]}]}

    def test_declared_customization_cannot_be_counted_as_canon(self):
        data = copy.deepcopy(self.data)
        data['claims'][0]['classification'] = 'user_customization'
        with self.assertRaises(ValueError): verify(data)
        data['claims'][0]['references'] = []
        self.assertEqual(verify(data)['checked_sources'], 0)

    def test_read_only_verification_catches_missing_tampered_and_wrong_chapter(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'synthetic.sqlite3'
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE chunks(id TEXT,sequence INTEGER,volume INTEGER,number_text TEXT,part INTEGER,passage TEXT)')
                db.execute('INSERT INTO chunks VALUES(?,1,1,\'one\',1,\'synthetic passage\')', ('a'*64,))
            db.close()
            before = path.read_bytes()
            self.assertEqual(verify(self.data, path)['checked_sources'], 1)
            self.assertEqual(path.read_bytes(), before)
            for field, value in [('chunk_id','b'*64),('part',2),('passage_sha256','0'*64)]:
                data = copy.deepcopy(self.data); data['claims'][0]['references'][0][field] = value
                with self.assertRaises(ValueError): verify(data, path)
            missing = Path(folder)/'missing.sqlite3'
            with self.assertRaises(FileNotFoundError): verify(self.data, missing)
            self.assertFalse(missing.exists())

    def test_duplicate_claim_is_rejected(self):
        self.data['claims'] *= 2
        with self.assertRaises(ValueError): verify(self.data)

if __name__ == '__main__': unittest.main()
