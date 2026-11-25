#!/usr/bin/env python3
"""Create reproducible, allow-listed offline and source releases."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
from tempfile import NamedTemporaryFile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist'
VERSION = json.loads((ROOT / 'manifest.json').read_text())['version']
BASE = f'Focuence-{VERSION}'
STAMP = (2026, 10, 22, 0, 0, 0)
COMMON_FILES = ['manifest.json', 'background.js', 'README.md', 'INSTALL.md', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.md', 'PRODUCT.md', 'DESIGN.md', 'model-lock.json']
COMMON_DIRS = ['app', 'panel', 'src', 'popup', 'icons', 'options', 'licenses', 'docs']
STORE_FILES = [
    'manifest.json', 'background.js', 'THIRD_PARTY_NOTICES.md',
    'inference/offscreen.html', 'inference/offscreen.js', 'inference/worker.bundle.js',
    'vendor/ort-wasm-simd-threaded.jsep.mjs', 'vendor/ort-wasm-simd-threaded.jsep.wasm',
    'vendor/ort-wasm-simd-threaded.mjs', 'vendor/ort-wasm-simd-threaded.wasm',
    'licenses/FlagEmbedding-MIT.txt', 'licenses/jinja-Apache-2.0.txt',
    'licenses/onnxruntime-MIT.txt', 'licenses/onnxruntime-ThirdPartyNotices.txt',
    'licenses/transformers-js-Apache-2.0.txt',
]
STORE_DIRS = {
    'app': {'.html', '.js', '.css'},
    'panel': {'.html', '.js', '.css'},
    'popup': {'.html', '.js', '.css'},
    'options': {'.html', '.js', '.css'},
    'src': {'.js', '.css'},
    'icons': {'.png'},
}
MODEL_DIR = 'models/bge-small-zh-v1.5'

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

def model_paths(lock):
    paths = []
    for item in lock['files']:
        name = PurePosixPath(item['path'])
        if name.is_absolute() or '..' in name.parts or str(name) != item['path'] or '\\' in str(name):
            raise ValueError(f'Invalid model path: {item["path"]}')
        path = ROOT / MODEL_DIR / name
        data = path.read_bytes()
        if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError(f'Model verification failed: {item["path"]}')
        paths.append(path)
    return paths

def package_store(models):
    worker = (ROOT / 'inference/worker.bundle.js').read_bytes()
    if b'https://cdn.jsdelivr.net/npm/@huggingface/transformers@' in worker:
        raise ValueError('Store worker has a remote WASM default. Run npm run build.')
    paths = [ROOT / name for name in STORE_FILES] + models
    for directory, suffixes in STORE_DIRS.items():
        paths.extend(path for path in files_in(directory)
                     if path.suffix in suffixes
                     and not any(part.startswith('.') for part in path.relative_to(ROOT).parts))
    entries = {}
    for path in paths:
        name = path.relative_to(ROOT).as_posix()
        if (name in entries or '\\' in name or ':' in name or '..' in path.relative_to(ROOT).parts
                or path.resolve() != path):
            raise ValueError(f'Invalid or duplicate store entry: {name}')
        entries[name] = path

    target = OUT / f'{BASE}-chrome-store.zip'
    with NamedTemporaryFile(dir=OUT, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        with zipfile.ZipFile(temporary, 'w') as archive:
            for name, path in sorted(entries.items()):
                add(archive, name, path.read_bytes())
        with zipfile.ZipFile(temporary) as archive:
            if archive.namelist() != sorted(entries) or archive.testzip() is not None:
                raise ValueError('Store ZIP verification failed')
        checksum = hashlib.sha256(temporary.read_bytes()).hexdigest()
        temporary.chmod(0o644)
        temporary.replace(target)
        target.with_suffix('.sha256').write_text(f'{checksum}  {target.name}\n')
    finally:
        temporary.unlink(missing_ok=True)
    print(f'{target.name}: {target.stat().st_size:,} bytes / {len(entries)} files', flush=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--store', action='store_true', help='build only the Chrome Web Store ZIP')
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    lock = json.loads((ROOT / 'model-lock.json').read_text())
    models = model_paths(lock)
    if args.store:
        package_store(models)
        return
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
