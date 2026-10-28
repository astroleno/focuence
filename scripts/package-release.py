#!/usr/bin/env python3
"""Create reproducible, allow-listed offline and source releases."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist'
VERSION = json.loads((ROOT / 'manifest.json').read_text())['version']
BASE = f'Focuence-{VERSION}'
STAMP = (2026, 10, 22, 0, 0, 0)
COMMON_FILES = ['manifest.json', 'background.js', 'README.md', 'INSTALL.md', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.md', 'PRODUCT.md', 'DESIGN.md', 'model-lock.json']
COMMON_DIRS = ['app', 'panel', 'src', 'popup', 'icons', 'options', 'licenses', 'docs']

def files_in(directory):
    path = ROOT / directory
    if not path.is_dir():
        raise FileNotFoundError(f'Missing required directory: {directory}')
    return [item for item in path.rglob('*') if item.is_file() and not item.name.startswith('.')]

def add(archive, name, data):
    info = zipfile.ZipInfo(name, STAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    archive.writestr(info, data, compresslevel=9)

def main():
    OUT.mkdir(exist_ok=True)
    lock = json.loads((ROOT / 'model-lock.json').read_text())
    for item in lock['files']:
        data = (ROOT / 'models/bge-small-zh-v1.5' / item['path']).read_bytes()
        if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError(f'Model verification failed: {item["path"]}')
    common = [ROOT / name for name in COMMON_FILES]
    for directory in COMMON_DIRS:
        common.extend(files_in(directory))
    runtime = common + files_in('models') + files_in('vendor') + [ROOT / 'inference' / name for name in ['offscreen.html', 'offscreen.js', 'worker.bundle.js']]
    source = common + [ROOT / name for name in ['package.json', 'package-lock.json', '.gitignore']] + files_in('scripts') + files_in('test')
    source.extend(ROOT / 'inference' / name for name in ['offscreen.html', 'offscreen.js', 'worker.js'])
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        dirty = bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=ROOT, text=True).strip())
    except (subprocess.CalledProcessError, FileNotFoundError):
        commit = 'source-archive'
        dirty = None
    source_hash = hashlib.sha256()
    for path in sorted(set(source), key=lambda item: item.relative_to(ROOT).as_posix()):
        name = path.relative_to(ROOT).as_posix()
        source_hash.update(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {name}\n'.encode())
    build_info = json.dumps({
        'version':VERSION,'releaseDate':'2026-10-28','sourceCommit':commit,
        'sourceDirty':dirty,'sourceTreeSha256':source_hash.hexdigest(),
        'baseRepository':'https://github.com/astroleno/focuence',
        'baseCommit':'240eaba9c1b5517b0c3fc96973c195b44042ef32',
        'modelRepository':lock['repository'],'modelRevision':lock['revision'],
        'runtime':'MV3 / bundled ONNX / single-thread WASM',
        'networkInference':'optional-user-configured', 'networkInferenceDefault':False
    }, ensure_ascii=False, indent=2).encode()+b'\n'
    artifacts = []
    for suffix, prefix, paths in [('offline',BASE,runtime),('source',BASE+'-source',source)]:
        target = OUT / f'{BASE}-{suffix}.zip'
        checksums=[]
        with zipfile.ZipFile(target,'w') as archive:
            for path in sorted(set(paths),key=lambda item:item.relative_to(ROOT).as_posix()):
                name=path.relative_to(ROOT).as_posix()
                data=path.read_bytes()
                add(archive,f'{prefix}/{name}',data)
                checksums.append(f'{hashlib.sha256(data).hexdigest()}  {name}')
            add(archive,f'{prefix}/build-info.json',build_info)
            checksums.append(f'{hashlib.sha256(build_info).hexdigest()}  build-info.json')
            add(archive,f'{prefix}/FILE_SHA256SUMS.txt',('\n'.join(checksums)+'\n').encode())
        with zipfile.ZipFile(target) as archive:
            bad = archive.testzip()
            if bad: raise ValueError(f'ZIP verification failed: {bad}')
        artifacts.append(target)
        print(f'{target.name}: {target.stat().st_size:,} bytes / {len(set(paths))+2} files',flush=True)
    guide = OUT / f'{BASE}-Guide.md'
    shutil.copyfile(ROOT/'INSTALL.md',guide)
    artifacts.append(guide)
    (OUT/'SHA256SUMS.txt').write_text(''.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n' for path in artifacts))

if __name__ == '__main__':
    main()
