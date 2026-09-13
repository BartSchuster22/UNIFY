"""Root-owned filesystem and real Ed25519 unit tests; tiny archives are fixtures only."""
import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch
import setup as s

VERIFIER = Path(__file__).resolve().parents[1] / 'stage6/release_trust.py'
spec = importlib.util.spec_from_file_location('trusted_release', VERIFIER)
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)


@unittest.skipUnless(os.geteuid() == 0, 'Requires isolated root-owned test paths')
class SetupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='dsh-bootstrap-test-', dir=Path.home())
        self.base = Path(self.tmp.name)
        self.archive = self.base / 'fixture.tar.gz'
        self.dest = self.base / 'prepared'
        self.verifier = self.base / 'release_trust.py'
        shutil.copyfile(VERIFIER, self.verifier)
        self.trust = self.base / 'trust.json'
        self.private = self.base / 'fixture-only-private.pem'
        v.keygen(self.private, self.trust, 'qa')
        self.files = {'release.json': b'{"fixture":true}\n', 'install.py': b'# fixture; never installed\n',
                      'alicactl': b'#!/bin/sh\nexit 97\n'}
        self.make_archive()
        self.args = argparse.Namespace(destination=str(self.dest), release_base='https://example.com/pinned-release',
            archive_name='fixture.tar.gz', archive_sha256=s.digest(self.archive),
            verifier=str(self.verifier), verifier_sha256=s.digest(self.verifier),
            trust=str(self.trust), trust_sha256=s.digest(self.trust), scope='qa')
        self.envelope = self.base / 'candidate-envelope.json'
        now = int(time.time())
        self.payload = {'schema': 'alica-release-admission/v1', 'scope': 'qa', 'sequence': 1,
            'issuedAt': now - 60, 'expiresAt': now + 3600, 'platform': 'linux/amd64',
            'acceptedPredecessors': [s.ZERO],
            'artifacts': {k: s.hashlib.sha256(b).hexdigest() for k, b in self.files.items()},
            'releaseSha256': s.hashlib.sha256(self.files['release.json']).hexdigest()}
        self.sign()

    def tearDown(self):
        self.tmp.cleanup()

    def sign(self):
        self.envelope.write_text(json.dumps(v.sign(self.payload, self.private)))

    def make_archive(self, extra=()):
        with tarfile.open(self.archive, 'w:gz') as t:
            for name, data in self.files.items():
                m = tarfile.TarInfo('bundle/' + name); m.size = len(data)
                t.addfile(m, io.BytesIO(data))
            for m, data in extra:
                t.addfile(m, io.BytesIO(data) if data is not None else None)

    def fake_download(self, url, target, limit):
        src = self.archive if url.endswith('fixture.tar.gz') else self.envelope
        shutil.copyfile(src, target)
        return src.stat().st_size

    def prepare(self):
        with patch.object(s, 'download', side_effect=self.fake_download):
            return s.prepare(self.args)

    def test_real_signature_and_safe_extract(self):
        r = self.prepare()
        self.assertTrue(r['prepared']); self.assertFalse(r['installationPerformed'])
        self.assertFalse(r['userJourneyAccepted']); self.assertFalse(r['distributionApproved'])
        self.assertEqual(s.read_state(self.dest)[2]['scope'], 'qa')
        self.assertEqual((self.dest / 'bundle/alicactl').stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.dest / 'bundle/install.py').stat().st_mode & 0o777, 0o644)

    def test_archive_tampering_before_extract(self):
        self.args.archive_sha256 = '1' * 64
        with self.assertRaisesRegex(s.Denied, 'Archive checksum'):
            self.prepare()
        self.assertFalse((self.dest / 'bundle').exists())
        self.assertFalse((self.dest / 'preparation.json').exists())

    def test_verifier_pin_before_network(self):
        self.args.verifier_sha256 = '1' * 64
        with patch.object(s, 'download') as download:
            with self.assertRaisesRegex(s.Denied, 'checksum'):
                s.prepare(self.args)
            download.assert_not_called()

    def test_wrong_scope(self):
        self.args.scope = 'production'
        with self.assertRaisesRegex(s.Denied, 'admission denied'):
            self.prepare()
        self.assertFalse((self.dest / 'preparation.json').exists())

    def test_expired_signed_envelope(self):
        self.payload.update(issuedAt=int(time.time())-7200, expiresAt=int(time.time())-3600)
        self.sign()
        with self.assertRaisesRegex(s.Denied, 'admission denied'):
            self.prepare()

    def test_invalid_signature(self):
        value = json.loads(self.envelope.read_text()); value['payload']['sequence'] = 2
        self.envelope.write_text(json.dumps(value))
        with self.assertRaisesRegex(s.Denied, 'admission denied'):
            self.prepare()

    def test_bundle_tampering_denied_on_reverification(self):
        self.prepare(); (self.dest / 'bundle/install.py').write_text('modified')
        with self.assertRaisesRegex(s.Denied, 'admission denied'):
            s.read_state(self.dest)

    def test_modified_external_trust_denied(self):
        self.prepare(); self.trust.write_text('{}')
        with self.assertRaisesRegex(s.Denied, 'checksum'):
            s.read_state(self.dest)

    def test_existing_destination_not_reused(self):
        self.dest.mkdir()
        with self.assertRaisesRegex(s.Denied, 'new preparation'):
            self.prepare()

    def test_symlink_destination(self):
        self.dest.symlink_to(self.base / 'missing')
        with self.assertRaisesRegex(s.Denied, 'Symlink'):
            self.prepare()

    def test_writable_ancestor(self):
        self.base.chmod(0o777)
        try:
            with self.assertRaisesRegex(s.Denied, 'non-writable'):
                self.prepare()
        finally:
            self.base.chmod(0o700)

    def test_http_and_credentials_denied(self):
        for url in ['http://example.com/x', 'https://user:pass@example.com/x', 'file:///root/x', 'https://example.com/#x']:
            with self.subTest(url=url), self.assertRaises(s.Denied):
                s.https_url(url)

    def test_redirect_downgrade_denied(self):
        with self.assertRaises(s.Denied):
            s.HTTPSOnly().redirect_request(None, None, 302, '', {}, 'http://example.com/x')

    def test_unsafe_archive_types_paths_duplicates(self):
        for name, kind in [('bundle/../escape', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE),
                           ('bundle/alicactl', tarfile.REGTYPE), ('bundle/link', tarfile.SYMTYPE),
                           ('bundle/hardlink', tarfile.LNKTYPE), ('bundle/dir', tarfile.DIRTYPE),
                           ('bundle/device', tarfile.CHRTYPE)]:
            with self.subTest(name=name):
                m = tarfile.TarInfo(name); m.type = kind; m.linkname = '/root/escape'
                self.make_archive([(m, b'' if kind == tarfile.REGTYPE else None)])
                out = self.base / ('bad-' + str(time.monotonic_ns()))
                with self.assertRaises(s.Denied):
                    s.unpack(self.archive, out)

    def test_expansion_limit(self):
        with patch.object(s, 'MAX_EXPANDED', 1), self.assertRaisesRegex(s.Denied, 'expansion limit'):
            s.unpack(self.archive, self.base / 'limited')

    def test_disk_reserve(self):
        with patch.object(s.shutil, 'disk_usage', return_value=shutil._ntuple_diskusage(100, 99, 1)):
            with self.assertRaisesRegex(s.Denied, 'headroom'):
                self.prepare()

    def request_args(self):
        return argparse.Namespace(cell='dsh2-internal', owner='owner', origin='https://dsh.example.com',
            port=443, bind='127.0.0.1', root=str(self.base / 'dsh2-internal'))

    def test_generic_request(self):
        self.assertEqual(s.request(self.request_args())['origin'], 'https://dsh.example.com')

    def test_existing_installation_never_gets_zero_predecessor_install(self):
        a = self.request_args(); Path(a.root).mkdir()
        with self.assertRaisesRegex(s.Denied, 'Fresh installation'):
            s.request(a)

    def test_installer_failure_not_reported_as_success(self):
        self.prepare()
        a = self.request_args(); a.destination = str(self.dest)
        original = s.subprocess.run
        def run(args, **kwargs):
            if args[:3] == ['docker', 'compose', 'version']:
                return s.subprocess.CompletedProcess(args, 0)
            return original(args, **kwargs)
        with patch.object(s.shutil, 'which', return_value='/fixture/prerequisite'), patch.object(s.subprocess, 'run', side_effect=run):
            with self.assertRaisesRegex(s.Denied, 'Installation failed'):
                s.install(a)

    def test_installer_fixture_exit_is_not_onboarding_acceptance(self):
        self.files['alicactl'] = b'#!/bin/sh\n# unit fixture, not a runtime installer\nexit 0\n'
        self.make_archive(); self.args.archive_sha256 = s.digest(self.archive)
        self.payload['artifacts']['alicactl'] = s.hashlib.sha256(self.files['alicactl']).hexdigest()
        self.sign(); self.prepare()
        a = self.request_args(); a.destination = str(self.dest)
        original = s.subprocess.run
        def run(args, **kwargs):
            if args[:3] == ['docker', 'compose', 'version']:
                return s.subprocess.CompletedProcess(args, 0)
            return original(args, **kwargs)
        with patch.object(s.shutil, 'which', return_value='/fixture/prerequisite'), patch.object(s.subprocess, 'run', side_effect=run):
            result = s.install(a)
        self.assertTrue(result['onboardingRequired'])
        self.assertFalse(result['userJourneyAccepted'])
        self.assertFalse(result['distributionApproved'])

    def test_modified_bundle_never_reaches_lifecycle(self):
        self.prepare(); (self.dest/'bundle/alicactl').write_text('# changed')
        a = self.request_args(); a.destination = str(self.dest)
        with patch.object(s.shutil, 'which') as which:
            with self.assertRaisesRegex(s.Denied, 'admission denied'):
                s.install(a)
            which.assert_not_called()

    def test_qa_hostname_and_port_mismatch_denied(self):
        a = self.request_args(); a.origin = 'https://stage7.qa.invalid'
        with self.assertRaisesRegex(s.Denied, 'QA fixture'):
            s.request(a)
        a.origin = 'https://dsh.example.com:8443'
        with self.assertRaisesRegex(s.Denied, 'port mismatch'):
            s.request(a)


if __name__ == '__main__':
    unittest.main()
