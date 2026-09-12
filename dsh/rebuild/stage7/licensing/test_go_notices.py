import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
import collect_go_notices as c

PURL = 'pkg:golang/example.com/test@v1.0.0'
PREFIX = 'example.com/test@v1.0.0/'


def archive(items):
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w') as z:
        for name, data in items:
            z.writestr(name, data)
    return b.getvalue()


class ArchiveTests(unittest.TestCase):
    def test_case_escape(self):
        self.assertEqual(c.url_for('pkg:golang/github.com/BurntSushi/toml@v1.5.0'), 'https://proxy.golang.org/github.com/!burnt!sushi/toml/@v/v1.5.0.zip')

    def test_missing_coordinate(self):
        for p in ['pkg:golang/caddy@v1.0.0', 'pkg:golang/example.com/a', 'pkg:golang/example.com/../a@v1.0.0']:
            with self.assertRaises(ValueError):
                c.url_for(p)

    def test_redirect(self):
        for url in ['http://proxy.golang.org/a', 'https://localhost/a', 'https://proxy.golang.org.evil/a', 'https://user@proxy.golang.org/a']:
            with self.assertRaises(ValueError):
                c.validate_url(url)

    def test_exact_notice_bytes(self):
        data = b'Example fixture notice\r\n '
        got = c.candidates(archive([(PREFIX+'LICENSE', data), (PREFIX+'a.go', b'package a')]), PURL)
        self.assertEqual(got, [{'path': 'LICENSE', 'sha256': c.digest(data), 'bytes': len(data)}])

    def test_wrong_identity(self):
        with self.assertRaisesRegex(ValueError, 'identity'):
            c.candidates(archive([('wrong@v1.0.0/LICENSE', b'test')]), PURL)

    def test_traversal(self):
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            c.candidates(archive([(PREFIX+'../LICENSE', b'test')]), PURL)

    def test_duplicate(self):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            data = archive([(PREFIX+'LICENSE', b'one'), (PREFIX+'LICENSE', b'two')])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            c.candidates(data, PURL)


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.input = self.base/'input.json'
        q = [{'purl': PURL, 'reviewStatus': 'licence-metadata-unresolved', 'type': 'go-module'}]
        self.input.write_text(json.dumps(q))
        self.addCleanup(patch.stopall)
        patch.object(c, 'INPUT', self.input).start()
        (self.base/'objects').mkdir()
        data = archive([(PREFIX+'LICENSE', b'fixture only')])
        self.h = c.digest(data)
        (self.base/'objects'/self.h).write_bytes(data)
        r = {'purl': PURL, 'legalDispositionApproved': False, 'binaryIdentityProven': False, 'url': c.url_for(PURL), 'archiveSha256': self.h, 'archiveBytes': len(data), 'notices': c.candidates(data, PURL), 'status': 'notice-candidates-observed'}
        self.report = {'inputSha256': c.digest(self.input.read_bytes()), 'results': [r], 'summary': c.summary([r], q)}
        self.save()

    def save(self):
        (self.base/'report.json').write_text(json.dumps(self.report))

    def test_positive(self):
        self.assertFalse(c.verify(self.base)['stage74Accepted'])

    def test_tampered_bytes(self):
        (self.base/'objects'/self.h).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'hash'):
            c.verify(self.base)

    def test_tampered_notice(self):
        self.report['results'][0]['notices'] = []
        self.save()
        with self.assertRaisesRegex(ValueError, 'extraction'):
            c.verify(self.base)

    def test_approval(self):
        self.report['summary']['stage74Accepted'] = True
        self.save()
        with self.assertRaisesRegex(ValueError, 'approval'):
            c.verify(self.base)

    def test_removed_coordinate(self):
        self.report['results'] = []
        self.save()
        with self.assertRaisesRegex(ValueError, 'coverage'):
            c.verify(self.base)

    def test_binary_claim(self):
        self.report['results'][0]['binaryIdentityProven'] = True
        self.save()
        with self.assertRaisesRegex(ValueError, 'approval'):
            c.verify(self.base)


if __name__ == '__main__':
    unittest.main()
