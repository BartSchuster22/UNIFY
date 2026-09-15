#!/usr/bin/env python3
"""Standalone verified-download bootstrap. Never imports candidate code.

The trusted bootstrap/verifier and external trust pin must be obtained separately.
Preparation is not installation, workload acceptance or distribution clearance.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.parse
import urllib.request

# Authenticated bundle inventory must stay immutable during lifecycle/imports.
# The flag protects this interpreter (including isolated mode); the environment
# protects non-isolated lifecycle subprocesses launched through this bootstrap.
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'

GIB = 1024 ** 3
MAX_ARCHIVE = 4 * GIB
MAX_EXPANDED = 12 * GIB
RESERVE = 2 * GIB
ZERO = '0' * 64


class Denied(ValueError):
    pass


def require(ok, message):
    if not ok:
        raise Denied(message)


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def checksum(value):
    require(isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value), 'Invalid SHA-256 pin')
    return value


def secure(path, existing=True):
    p = Path(path)
    require(p.is_absolute() and '..' not in p.parts, 'Absolute canonical path required')
    for q in [*reversed(p.parents), p]:
        if q == p and not existing and not q.exists() and not q.is_symlink():
            continue
        s = q.lstat()
        require(not stat.S_ISLNK(s.st_mode), 'Symlink in protected path')
        require(s.st_uid == 0 and not s.st_mode & 0o022, 'Root-owned non-writable path required: ' + str(q))
        if q != p:
            require(stat.S_ISDIR(s.st_mode), 'Non-directory ancestor')
    return p


def pinned_file(path, expected):
    p = secure(path)
    require(p.is_file(), 'Regular protected file required')
    require(digest(p) == checksum(expected), 'Trusted file checksum mismatch')
    return p


def https_url(value):
    u = urllib.parse.urlsplit(value)
    require(u.scheme == 'https' and u.hostname and not u.username and not u.password
            and not u.fragment, 'HTTPS URL without credentials or fragment required')
    return value


class HTTPSOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        https_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url, target, limit):
    https_url(url)
    opener = urllib.request.build_opener(HTTPSOnly())
    size = 0
    with opener.open(url, timeout=60) as response, Path(target).open('xb') as output:
        https_url(response.url)
        if response.headers.get('Content-Length'):
            require(int(response.headers['Content-Length']) <= limit, 'Download exceeds size limit')
        while True:
            block = response.read(1024 * 1024)
            if not block:
                break
            size += len(block)
            require(size <= limit, 'Download exceeds size limit')
            require(shutil.disk_usage(Path(target).parent).free > RESERVE, 'Download disk reserve exhausted')
            output.write(block)
    return size


def unpack(archive, bundle):
    """No extractall: only unique flat regular bundle members; bounded disk use."""
    bundle = Path(bundle)
    bundle.mkdir(mode=0o755)
    seen = set()
    expanded = 0
    with tarfile.open(archive, 'r|gz') as t:
        for member in t:
            parts = member.name.split('/')
            require(len(parts) == 2 and parts[0] == 'bundle'
                    and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', parts[1]), 'Unsafe archive member')
            require(member.isfile() and member.name not in seen, 'Nonregular or duplicate archive member')
            require(member.size >= 0, 'Negative member size')
            seen.add(member.name)
            expanded += member.size
            require(len(seen) <= 10000 and expanded <= MAX_EXPANDED, 'Archive expansion limit')
            require(shutil.disk_usage(bundle).free >= member.size + RESERVE, 'Insufficient extraction space')
            source = t.extractfile(member)
            require(source is not None, 'Missing member data')
            p = bundle / parts[1]
            with source, p.open('xb') as out:
                shutil.copyfileobj(source, out, length=1024 * 1024)
            require(p.stat().st_size == member.size, 'Truncated archive member')
            p.chmod(0o755 if p.name == 'alicactl' else 0o644)
    require({'bundle/release.json', 'bundle/alicactl', 'bundle/install.py'} <= seen,
            'Missing installation entrypoints')
    return {'members': len(seen), 'expandedBytes': expanded}


def write_json(path, value):
    with Path(path).open('x') as f:
        json.dump(value, f, indent=2, sort_keys=True)
        f.write('\n')


def admission(state, destination):
    verifier = pinned_file(state['verifier'], state['verifierSha256'])
    trust = pinned_file(state['trust'], state['trustSha256'])
    destination = secure(destination)
    require(destination not in trust.parents and destination not in verifier.parents,
            'Trust and verifier must be external to preparation directory')
    result = subprocess.run([
        sys.executable, '-I', str(verifier), 'verify', '--bundle', str(destination / 'bundle'),
        '--trust', str(trust), '--envelope', str(destination / 'candidate-envelope.json'),
        '--scope', state['scope'], '--installed-sequence', '0', '--current', ZERO,
    ], capture_output=True, text=True, timeout=600)
    require(result.returncode == 0, 'Release admission denied; check expiry, signature, scope and inventory (no bypass)')
    data = json.loads(result.stdout)
    require(data.get('signatureVerified') is True and data.get('releaseSha256'), 'Invalid verifier result')
    return data


def prepare(a):
    require(os.geteuid() == 0, 'Root operator required')
    require(platform.system() == 'Linux' and platform.machine() in ('x86_64', 'amd64'), 'Linux amd64 required')
    destination = secure(a.destination, existing=False)
    require(not destination.exists(), 'Use a new preparation directory; failed downloads are retained')
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*\.tar\.gz', a.archive_name), 'Invalid archive basename')
    checksum(a.archive_sha256)
    base = https_url(a.release_base)
    require(not urllib.parse.urlsplit(base).query, 'Release base must not contain query parameters')
    verifier = pinned_file(a.verifier, a.verifier_sha256)
    trust = pinned_file(a.trust, a.trust_sha256)
    require(destination not in verifier.parents and destination not in trust.parents, 'External trust required')
    require(shutil.disk_usage(destination.parent).free >= MAX_ARCHIVE + RESERVE, 'At least 6 GiB preparation headroom required')
    os.umask(0o077)
    destination.mkdir(mode=0o755)
    state = {'schema': 'alica-user-preparation/v1', 'scope': a.scope,
             'releaseBase': base, 'archive': a.archive_name, 'archiveSha256': a.archive_sha256,
             'verifier': str(verifier), 'verifierSha256': a.verifier_sha256,
             'trust': str(trust), 'trustSha256': a.trust_sha256}
    archive = destination / a.archive_name
    size = download(base.rstrip('/') + '/' + a.archive_name, archive, MAX_ARCHIVE)
    require(digest(archive) == a.archive_sha256, 'Archive checksum mismatch; no code executed')
    download(base.rstrip('/') + '/candidate-envelope.json', destination / 'candidate-envelope.json', 2 * 1024 ** 2)
    extracted = unpack(archive, destination / 'bundle')
    verified = admission(state, destination)
    state.update({'downloadedBytes': size, 'extraction': extracted, 'admission': verified,
                  'prepared': True, 'installationPerformed': False, 'userJourneyAccepted': False,
                  'distributionApproved': False})
    write_json(destination / 'preparation.json', state)
    return state


def read_state(destination):
    destination = secure(destination)
    secure(destination / 'preparation.json')
    state = json.loads((destination / 'preparation.json').read_text())
    require(state.get('schema') == 'alica-user-preparation/v1' and state.get('prepared') is True,
            'No completed preparation receipt')
    return destination, state, admission(state, destination)


def request(a):
    require(re.fullmatch(r'dsh2-[a-z0-9-]{3,40}', a.cell), 'Cell must use supported dsh2- namespace')
    require(re.fullmatch(r'[A-Za-z0-9_-]{3,64}', a.owner), 'Invalid owner name')
    u = urllib.parse.urlsplit(a.origin)
    require(u.scheme == 'https' and not u.username and not u.password and not u.path
            and not u.query and not u.fragment and re.fullmatch(r'[a-z0-9.-]+', u.hostname or ''),
            'Canonical HTTPS origin required')
    require((u.port or 443) == a.port and (a.port == 443 or 1024 <= a.port <= 65535), 'Origin/port mismatch')
    require(not u.hostname.endswith('.invalid'), 'Use an operator-owned hostname, not a QA fixture')
    require(a.bind in ('127.0.0.1', '0.0.0.0'), 'Unsupported bind')
    root = secure(a.root, existing=False)
    require(root.name == a.cell and not root.exists(), 'Fresh installation requires a new root matching the cell')
    r = {'cell': a.cell, 'origin': a.origin, 'owner': a.owner, 'port': a.port, 'bind': a.bind}
    mode = getattr(a, 'tls_mode', 'engineering')
    network = getattr(a, 'edge_network', None)
    require(mode in ('engineering', 'acme', 'proxy'), 'Unsupported TLS mode')
    if mode != 'engineering':
        require(a.port == 443 and not a.origin.endswith(':443'), 'Managed TLS requires canonical HTTPS port 443')
        r['tls_mode'] = mode
    if mode == 'proxy':
        require(isinstance(network, str) and re.fullmatch(r'dsh2-[a-z0-9-]{3,40}-edge', network), 'Dedicated proxy edge network required')
        r['edge_network'] = network
    else:
        require(network is None, 'Edge network is only valid with proxy TLS')
    return r


def install(a):
    require(os.geteuid() == 0, 'Root operator required')
    destination, state, verified = read_state(a.destination)
    r = request(a)
    for binary in ('docker', 'openssl'):
        require(shutil.which(binary), 'Missing prerequisite: ' + binary)
    compose = subprocess.run(['docker', 'compose', 'version'], capture_output=True, timeout=30)
    require(compose.returncode == 0, 'Docker Compose v2 required')
    req = destination / 'request.json'
    if req.exists():
        secure(req)
        require(json.loads(req.read_text()) == r, 'Prepared request differs; use a new preparation directory')
    else:
        write_json(req, r)
    command = [str(destination / 'bundle/alicactl'), 'install', '--bundle', str(destination / 'bundle'),
               '--root', str(Path(a.root)), '--request', str(req), '--release-sha256', verified['releaseSha256']]
    # The authenticated alicactl remains the only lifecycle writer. No Docker edits here.
    completed = subprocess.run(command, timeout=1800)
    require(completed.returncode == 0, 'Installation failed; preserve diagnostics and follow documented same-bundle recovery')
    import shlex
    command = 'sudo python3 ' + shlex.quote(str(Path(__file__).resolve()))
    arguments = ' --destination ' + shlex.quote(str(destination)) + ' --root ' + shlex.quote(str(a.root))
    return {'signInUrl': r['origin'], 'ownerUsername': r['owner'],
            'onboardingCommand': command + ' onboarding' + arguments,
            'initialPasswordCommand': command + ' onboarding' + arguments + ' --reveal-initial-password',
            'ownerRecoveryCommand': command + ' recover-owner' + arguments,
            'credentialNotice': 'Initial password only; never reuse after changing it. Retrieve interactively on the installation server. Public registration stays disabled.',
            'installerExit': completed.returncode, 'root': str(a.root),
            'ownerPasswordFile': str(Path(a.root) / 'secrets/owner-password'),
            'onboardingRequired': True, 'userJourneyAccepted': False, 'distributionApproved': False}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='action', required=True)
    prep = sub.add_parser('prepare')
    for flag in ('destination', 'release-base', 'archive-name', 'archive-sha256', 'trust', 'trust-sha256', 'verifier', 'verifier-sha256'):
        prep.add_argument('--' + flag, required=True)
    prep.add_argument('--scope', choices=('qa', 'production'), required=True)
    verify = sub.add_parser('verify')
    verify.add_argument('--destination', required=True)
    ins = sub.add_parser('install')
    for flag in ('destination', 'root', 'cell', 'origin', 'owner'):
        ins.add_argument('--' + flag, required=True)
    ins.add_argument('--port', type=int, default=443)
    ins.add_argument('--bind', choices=('127.0.0.1', '0.0.0.0'), default='127.0.0.1')
    ins.add_argument('--tls-mode', choices=('engineering', 'acme', 'proxy'), default='engineering')
    ins.add_argument('--edge-network', help='Operator-provisioned dedicated dsh2-*-edge network for proxy TLS')
    for action in ('onboarding', 'recover-owner'):
        owner = sub.add_parser(action)
        owner.add_argument('--destination', required=True)
        owner.add_argument('--root', required=True)
        if action == 'onboarding':
            owner.add_argument('--reveal-initial-password', action='store_true')
    a = p.parse_args()
    require(os.geteuid() == 0, 'Root operator required')
    if a.action == 'prepare':
        result = prepare(a)
    elif a.action == 'verify':
        result = read_state(a.destination)[2]
    elif a.action in ('onboarding', 'recover-owner'):
        import onboarding
        result = onboarding.run(a)
    else:
        result = install(a)
        print('Installation finished; owner onboarding is still required.\nSign in: ' + result['signInUrl'] + '\nUsername: ' + result['ownerUsername'] + '\nRetrieve the initial password locally:\n' + result['initialPasswordCommand'] + '\nAfter first sign-in, change the password and complete your profile.\nLost your chosen password? Explicit reset (revokes identity sessions):\n' + result['ownerRecoveryCommand'], file=__import__('sys').stderr)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (Denied, OSError, ValueError, subprocess.SubprocessError) as exc:
        # Do not print credential-bearing upstream response bodies or environment.
        raise SystemExit(type(exc).__name__ + ': ' + str(exc))
