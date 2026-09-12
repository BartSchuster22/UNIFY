import json
import shutil
import tempfile
import unittest
from pathlib import Path
import match_go_licence_texts as c


class TextTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = c.BASE/'go-text-review'
        cls.report = json.loads((cls.base/'report.json').read_text())
        cls.templates = {n: (cls.base/'objects'/v['sha256']).read_text() for n, v in cls.report['templates'].items()}

    def test_mit(self):
        self.assertEqual(c.match(self.templates['MIT'].replace('<year> <copyright holders>', '2026 Test Author'), self.templates), 'MIT')

    def test_apache(self):
        self.assertEqual(c.match(self.templates['Apache-2.0'], self.templates), 'Apache-2.0')

    def test_added_restriction(self):
        for text in self.templates.values():
            self.assertIsNone(c.match(text+'\nCommercial use prohibited.', self.templates))

    def test_prefixed_restriction(self):
        self.assertIsNone(c.match('Commercial use prohibited.\n'+self.templates['MIT'], self.templates))

    def test_heading_is_not_match(self):
        self.assertIsNone(c.match('Apache License Version 2.0', self.templates))

    def test_modified_body(self):
        self.assertIsNone(c.match(self.templates['MIT'].replace('free of charge', 'for a fee'), self.templates))

    def test_whitespace_only(self):
        self.assertEqual(c.match(self.templates['Apache-2.0'].replace('\n', '\n  '), self.templates), 'Apache-2.0')

    def test_replay_and_approval_rejection(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)/'evidence'
            shutil.copytree(self.base, out)
            self.assertFalse(c.verify(out)['stage74Accepted'])
            p = out/'report.json'
            r = json.loads(p.read_text())
            r['summary']['stage74Accepted'] = True
            p.write_text(json.dumps(r))
            with self.assertRaisesRegex(ValueError, 'approval'):
                c.verify(out)

    def test_template_tamper(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)/'evidence'
            shutil.copytree(self.base, out)
            (out/'objects'/self.report['templates']['MIT']['sha256']).write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'bytes'):
                c.verify(out)


if __name__ == '__main__':
    unittest.main()
