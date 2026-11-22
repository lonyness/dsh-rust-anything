"""Maintainer gate: verify fixed, already downloaded assets; never install or fetch anything."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PROVENANCE = 'runtime/upstream-v3.3.0.json'
BINARY = 'runtime/win32-x64/rust-anything.exe'


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


def verify_package(path, pkg, win_sha):
    with tarfile.open(path, 'r:gz') as archive:
        check(digest(tar_bytes(archive, 'package/' + BINARY)), win_sha, 'tgz/' + BINARY)
        check(digest(tar_bytes(archive, 'package/' + PROVENANCE)), digest((ROOT / PROVENANCE).read_bytes()), 'packed provenance')
        manifest = json.loads(tar_bytes(archive, 'package/package.json'))
        for key in ('name', 'version'):
            check(manifest[key], pkg[key], 'packed ' + key)
    return digest(path.read_bytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('assets', type=Path, help='directory with the official SHA256SUMS and five v3.3.0 archives')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--pack-to', type=Path, metavar='DIR', help='create a candidate only after all checks pass')
    mode.add_argument('--tgz', type=Path, help='recheck an existing candidate, without repacking')
    args = parser.parse_args()
    sources = json.loads((ROOT / PROVENANCE).read_bytes())
    pkg = json.loads((ROOT / 'package.json').read_bytes())
    win_sha = verify_sources(args.assets, sources)
    if args.tgz:
        output = args.tgz.resolve()
        sha = verify_package(output, pkg, win_sha)
    else:
        output = (args.pack_to / f'{pkg["name"]}-{pkg["version"]}.tgz').resolve()
        if output.exists():
            raise FileExistsError(f'refusing to replace {output}; use --tgz to recheck it')
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output.parent) as staging:
            npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
            subprocess.run([npm or 'npm', 'pack', '--ignore-scripts', '--silent', '--pack-destination', staging], cwd=ROOT, check=True)
            staged = Path(staging) / output.name
            sha = verify_package(staged, pkg, win_sha)
            staged.rename(output)
    print(f'candidate: {output}\nSHA-256: {sha}\nofficial / checkout / packed Windows EXE: {win_sha}')


if __name__ == '__main__':
    main()
