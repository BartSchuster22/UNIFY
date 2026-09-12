import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import collect_uv_workspace as c


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.queue = [{'name': 'uv-pep440', 'version': '0.0.39', 'type': 'rust-crate', 'purl': 'pkg:cargo/uv-pep440@0.0.39', 'reviewStatus': 'licence-metadata-unresolved', 'legalDispositionApproved': False}]
        self.material = {'Cargo.toml': b'[workspace]\nmembers=["crates/*"]\n[workspace.package]\nlicense="MIT OR Apache-2.0"\n', 'LICENSE-APACHE': b'fixture', 'LICENSE-MIT': b'fixture', 'crates/uv-pep440/Cargo.toml': b'[package]\nname="uv-pep440"\nversion="0.0.39"\nlicense="Apache-2.0 OR BSD-2-Clause"\ninclude=["License-Apache","License-BSD"]\n', 'crates/uv-pep440/License-Apache': b'fixture Apache', 'crates/uv-pep440/License-BSD': b'fixture BSD'}

    def test_local_override_not_inherited(self):
        rows, result = c.derive(self.queue, self.material.__getitem__)
        self.assertEqual(rows[0]['workspaceEvidence']['declaration'], 'Apache-2.0 OR BSD-2-Clause')
        self.assertIsNone(rows[0]['workspaceEvidence']['inheritedFrom'])
        self.assertFalse(result['stage74Accepted'])
        self.assertEqual(self.queue[0]['reviewStatus'], 'licence-metadata-unresolved')

    def test_inheritance(self):
        p = 'crates/uv-pep440/Cargo.toml'
        self.material[p] = self.material[p].replace(b'license="Apache-2.0 OR BSD-2-Clause"', b'license.workspace=true')
        rows, _ = c.derive(self.queue, self.material.__getitem__)
        self.assertEqual(rows[0]['workspaceEvidence']['declaration'], 'MIT OR Apache-2.0')

    def test_mismatch(self):
        self.queue[0]['version'] = 'wrong'
        with self.assertRaisesRegex(ValueError, 'identity'):
            c.derive(self.queue, self.material.__getitem__)

    def test_missing_override_text(self):
        del self.material['crates/uv-pep440/License-BSD']
        with self.assertRaises(KeyError):
            c.derive(self.queue, self.material.__getitem__)

    def test_excluded(self):
        self.material['Cargo.toml'] = self.material['Cargo.toml'].replace(b'members=["crates/*"]', b'members=["crates/*"]\nexclude=["crates/uv-pep440"]')
        with self.assertRaisesRegex(ValueError, 'Excluded'):
            c.derive(self.queue, self.material.__getitem__)

    def fixture(self, out):
        input_path = out/'input.json'
        input_path.write_text(json.dumps(self.queue))
        (out/'objects').mkdir()
        sources = {}
        for path, data in self.material.items():
            h = c.sha(data)
            (out/'objects'/h).write_bytes(data)
            sources[path] = {'url': c.ROOT+path, 'sha256': h, 'bytes': len(data)}
        rows, summary = c.derive(self.queue, self.material.__getitem__)
        report = {'commit': c.PIN, 'inputSha256': c.sha(input_path.read_bytes()), 'sources': sources, 'summary': summary}
        (out/'report.json').write_text(json.dumps(report))
        (out/'review-queue.json').write_text(json.dumps(rows))
        return input_path

    def test_replay_and_tamper(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            p = self.fixture(out)
            with patch.object(c, 'INPUT', p):
                self.assertEqual(c.verify(out)['addedMetadataOccurrences'], 1)
                (out/'objects'/c.sha(b'fixture BSD')).write_bytes(b'changed')
                with self.assertRaisesRegex(ValueError, 'hash'):
                    c.verify(out)

    def test_queue_approval(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            p = self.fixture(out)
            rows = json.loads((out/'review-queue.json').read_text())
            rows[0]['legalDispositionApproved'] = True
            (out/'review-queue.json').write_text(json.dumps(rows))
            with patch.object(c, 'INPUT', p), self.assertRaisesRegex(ValueError, 'queue'):
                c.verify(out)


if __name__ == '__main__':
    unittest.main()
