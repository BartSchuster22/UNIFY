import copy
import json
import unittest
from unittest.mock import patch
import match_shipped_python as c


class ShippedTests(unittest.TestCase):
    def setUp(self):
        r = json.loads((c.BASE/'go-text-review/report.json').read_text())
        self.templates = {n: (c.BASE/'go-text-review/objects'/v['sha256']).read_text() for n, v in r['templates'].items()}
        self.data = self.templates['Apache-2.0'].encode()
        self.row = {'type': 'python', 'reviewStatus': 'licence-metadata-unresolved', 'image': 'test', 'name': 'a-package', 'version': '1.0', 'locations': [{'path': '/site/a_package-1.0.dist-info/METADATA', 'layerID': 'layer'}]}
        self.index = {'layers': {'layer': {'images': ['image']}}, 'candidates': [{'layer': 'layer', 'path': 'site/a_package-1.0.dist-info/licenses/LICENSE', 'sha256': c.sha(self.data)}], 'resolvedReferences': []}
        self.images = {'test': {'imageId': 'image'}}

    def run_bind(self):
        return c.bind(self.row, self.index, self.images, lambda h: self.data, self.templates)

    def test_exact_binding(self):
        self.assertEqual(self.run_bind()[0]['observedTextId'], 'Apache-2.0')

    def test_wrong_image(self):
        self.images['test']['imageId'] = 'another-image'
        self.assertEqual(self.run_bind(), [])

    def test_wrong_version(self):
        self.row['version'] = '2.0'
        self.assertEqual(self.run_bind(), [])

    def test_wrong_name(self):
        self.row['name'] = 'other'
        self.assertEqual(self.run_bind(), [])

    def test_sibling_directory(self):
        self.index['candidates'][0]['path'] = 'site/a_package-1.0.dist-info-evil/LICENSE'
        self.assertEqual(self.run_bind(), [])

    def test_changed_bytes(self):
        self.data += b'changed'
        with self.assertRaisesRegex(ValueError, 'hash'):
            self.run_bind()

    def test_traversal(self):
        self.row['locations'][0]['path'] = '/site/../a_package-1.0.dist-info/METADATA'
        with self.assertRaisesRegex(ValueError, 'Traversal'):
            self.run_bind()

    def test_wrong_reference_image(self):
        ref = self.index['candidates'].pop()
        ref['imageId'] = 'another-image'
        self.index['resolvedReferences'].append(ref)
        self.assertEqual(self.run_bind(), [])

    def test_known_status_not_replaced(self):
        self.row['reviewStatus'] = 'known'
        self.assertEqual(self.run_bind(), [])


if __name__ == '__main__':
    unittest.main()
