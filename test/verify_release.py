"""Maintainer gate: verify fixed, already downloaded assets and a publishable candidate.

A candidate must contain exactly the members npm would publish, every member must be
byte-identical to the current git commit, and its unpacked copy must pass its own suite.
Never installs, fetches or repacks anything.

Usage:
  python test/verify_release.py ASSETS                  # assets only
  python test/verify_release.py ASSETS --pack-to DIR     # pack only after all checks pass
  python test/verify_release.py ASSETS --tgz FILE        # recheck an existing candidate
  python test/verify_release.py --self-check             # comparator only, no npm/network
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PROVENANCE = 'runtime/upstream-v3.3.0.json'
BINARY = 'runtime/win32-x64/rust-anything.exe'
TESTS = 'test/*.test.cjs'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def check(actual, expected, label):
    if actual != expected:
        raise ValueError(f'{label}: expected {expected}, got {actual}')


def tar_bytes(archive, name):
    matches = [m for m in archive.getmembers() if m.name == name]
    if len(matches) != 1 or not matches[0].isfile():
        raise ValueError(f'{archive.name}: expected exactly one regular file {name}')
    return archive.extractfile(matches[0]).read()


def git_blob(path):
    try:
        result = subprocess.run(['git', '-C', str(ROOT), 'cat-file', 'blob', f'HEAD:{path}'], capture_output=True)
    except OSError as error:
        raise ValueError(f'git is required to read committed bytes: {error}') from error
    if result.returncode != 0:
        raise ValueError(f'member package/{path}: not in the current git commit '
                         f'(git HEAD:{path}: {result.stderr.decode(errors="replace").strip()})')
    return result.stdout


def compare_members(files, expected, label):
    missing = sorted(set(expected) - set(files))
    extra = sorted(set(files) - set(expected))
    if missing or extra:
        details = []
        if missing:
            details.append('missing ' + ', '.join(missing))
        if extra:
            details.append('unexpected ' + ', '.join(extra))
        raise ValueError(f'{label}: member set differs from the npm publish list '
                         f'({len(expected)} expected, {len(files)} found): ' + '; '.join(details))


def verify_files(files, expected, pkg, win_sha, label, read_committed):
    compare_members(files, expected, label)
    check(digest(files['package/' + BINARY]), win_sha, f'{label}/package/{BINARY}')
    check(digest(files['package/' + PROVENANCE]), digest((ROOT / PROVENANCE).read_bytes()), f'{label}/package/{PROVENANCE}')
    manifest = json.loads(files['package/package.json'])
    for key in ('name', 'version'):
        check(manifest[key], pkg[key], f'{label} package/{key}')
    for name in expected:
        path = name.removeprefix('package/')
        want = read_committed(path)
        got = files[name]
        if got != want:
            offset = next((i for i, (a, b) in enumerate(zip(got, want)) if a != b), min(len(got), len(want)))
            raise ValueError(f'{label}: member {name} differs from git HEAD:{path} at byte {offset} '
                             f'(archive {len(got)} bytes, commit {len(want)} bytes)')


def published_members():
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if npm is None:
        raise ValueError('npm is required to list published members (npm not on PATH)')
    result = subprocess.run([npm, 'pack', '--dry-run', '--json', '--ignore-scripts'],
                            cwd=ROOT, capture_output=True, encoding='utf-8')
    if result.returncode != 0:
        raise ValueError(f'npm pack --dry-run --json failed (exit {result.returncode}): {result.stderr.strip()}')
    try:
        entries = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(f'npm pack --dry-run --json: files list is not JSON: {error}: {result.stdout[:500]}') from error
    if not isinstance(entries, list) or len(entries) != 1:
        raise ValueError(f'npm pack --dry-run --json: expected one entry, got {len(entries) if isinstance(entries, list) else type(entries).__name__}')
    if 'files' not in entries[0]:
        raise ValueError('npm pack --dry-run --json: entry[0] has no files field')
    paths = [item['path'] for item in entries[0]['files']]
    if not paths:
        raise ValueError('npm pack --dry-run --json: files[] is empty')
    return ['package/' + path for path in paths]


def unpacked_tests(path):
    node = shutil.which('node')
    if node is None:
        raise ValueError('unpacked tests: not run (no node on PATH) - release verification is incomplete')
    with tempfile.TemporaryDirectory() as temporary:
        with tarfile.open(path, 'r:gz') as archive:
            archive.extractall(temporary, filter='data')
        package = Path(temporary) / 'package'
        tests = sorted(p.relative_to(package).as_posix() for p in package.glob(TESTS))
        if not tests:
            raise ValueError(f'{path.name}: unpacked package has no {TESTS}')
        result = subprocess.run([node, '--test', *tests], cwd=package, capture_output=True, encoding='utf-8', errors='replace')
        if result.returncode != 0:
            raise ValueError(f'{path.name}: unpacked tests failed (node exit {result.returncode}):\n'
                             f'{result.stdout}{result.stderr}')
        counts = dict(re.findall(r'^# (tests|pass|fail) (\d+)$', result.stdout, re.MULTILINE))
        print(f'unpacked tests: {len(tests)} files, {counts.get("tests", "?")} tests, '
              f'{counts.get("pass", "?")} pass, {counts.get("fail", "?")} fail, node exit 0')


def verify_sources(directory, sources):
    checksum_file = (directory / 'SHA256SUMS').read_bytes()
    check(digest(checksum_file), sources['sha256sumsSha256'], 'official SHA256SUMS')
    sums = {}
    for line in checksum_file.decode('ascii').splitlines():
        sha, name = line.split(maxsplit=1)
        name = name.removeprefix('*')
        if name in sums:
            raise ValueError(f'duplicate checksum: {name}')
        sums[name] = sha
    platforms = sources['platforms']
    check(set(platforms), {'win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64'}, 'platforms')
    for platform, a in platforms.items():
        path = directory / a['archive']
        check(sums[path.name], a['archiveSha256'], f'SHA256SUMS/{path.name}')
        check(digest(path.read_bytes()), a['archiveSha256'], str(path))  # before opening the archive
        if platform == 'win32-x64':
            with zipfile.ZipFile(path) as archive:
                check(archive.namelist().count(a['member']), 1, a['member'])
                contents = archive.read(a['member'])
        else:
            with tarfile.open(path, 'r:gz') as archive:
                contents = tar_bytes(archive, a['member'])
        check(digest(contents), a['executableSha256'], a['member'])
        print(f'{platform}: archive={a["archiveSha256"]} executable={a["executableSha256"]}')
    win_sha = platforms['win32-x64']['executableSha256']
    check(digest((ROOT / BINARY).read_bytes()), win_sha, 'checkout/' + BINARY)
    return win_sha


def verify_package(path, expected, pkg, win_sha):
    with tarfile.open(path, 'r:gz') as archive:
        files = {}
        for member in archive.getmembers():
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError(f'{path.name}: member {member.name} is not a regular file')
            if member.name in files:
                raise ValueError(f'{path.name}: duplicate member {member.name}')
            files[member.name] = archive.extractfile(member).read()
    verify_files(files, expected, pkg, win_sha, path.name, git_blob)
    print(f'{path.name}: {len(files)} members match the npm publish list, all bytes match git HEAD')
    unpacked_tests(path)
    return digest(path.read_bytes())


def self_check():
    pkg = {'name': 'self-check', 'version': '0.0.0'}
    win_sha = digest(b'self-check exe')

    def members():
        return {
            'package/' + BINARY: b'self-check exe',
            'package/' + PROVENANCE: (ROOT / PROVENANCE).read_bytes(),
            'package/a.txt': b'alpha',
            'package/package.json': json.dumps(pkg).encode(),
        }

    expected = sorted(members())
    blobs = {name.removeprefix('package/'): data for name, data in members().items()}
    cases = [
        ('correct member set and content', members(), True),
        ('extra member', {**members(), 'package/extra.txt': b'extra'}, False),
        ('missing member', {name: data for name, data in members().items() if name != 'package/a.txt'}, False),
        ('tampered member', {**members(), 'package/a.txt': b'alphA'}, False),
    ]
    inverted = 0
    for name, files, should_pass in cases:
        try:
            verify_files(files, expected, pkg, win_sha, 'self-check', blobs.__getitem__)
            accepted, detail = True, 'accepted'
        except ValueError as error:
            accepted, detail = False, str(error)
        ok = accepted == should_pass
        inverted += not ok
        print(f'self-check {name}: {"ok" if ok else "INVERTED"} '
              f'({"accepted" if accepted else "rejected"})' + ('' if accepted else f' {detail}'))
    if inverted:
        raise SystemExit(f'self-check: {inverted} inverted expectation(s)')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('assets', nargs='?', type=Path,
                        help='directory with the official SHA256SUMS and five v3.3.0 archives (with --pack-to or --tgz)')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--pack-to', type=Path, metavar='DIR', help='create a candidate only after all checks pass')
    mode.add_argument('--tgz', type=Path, help='recheck an existing candidate, without repacking')
    mode.add_argument('--self-check', action='store_true',
                      help='exercise the member/content comparators on synthetic data; no npm, network or packing')
    args = parser.parse_args()
    if args.self_check:
        self_check()
        return
    if args.assets is None:
        parser.error('assets directory is required with --pack-to or --tgz')
    sources = json.loads((ROOT / PROVENANCE).read_bytes())
    pkg = json.loads((ROOT / 'package.json').read_bytes())
    expected = published_members()
    win_sha = verify_sources(args.assets, sources)
    if args.tgz:
        output = args.tgz.resolve()
        sha = verify_package(output, expected, pkg, win_sha)
    else:
        output = (args.pack_to / f'{pkg["name"]}-{pkg["version"]}.tgz').resolve()
        if output.exists():
            raise FileExistsError(f'refusing to replace {output}; use --tgz to recheck it')
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output.parent) as staging:
            npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
            subprocess.run([npm or 'npm', 'pack', '--ignore-scripts', '--silent', '--pack-destination', staging], cwd=ROOT, check=True)
            staged = Path(staging) / output.name
            sha = verify_package(staged, expected, pkg, win_sha)
            staged.rename(output)
    print(f'candidate: {output}\nSHA-256: {sha}\nofficial / checkout / packed Windows EXE: {win_sha}')


if __name__ == '__main__':
    main()
