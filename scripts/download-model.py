#!/usr/bin/env python3
"""Download the pinned public BGE model for the fully offline release."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPO = 'Xenova/bge-small-zh-v1.5'
REVISION = '75c43b069aac4d136ba6bc1122f995fedcfd2781'
FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json',
         'special_tokens_map.json', 'vocab.txt', 'onnx/model_quantized.onnx', 'README.md']
DEST = ROOT / 'models' / 'bge-small-zh-v1.5'

def main():
    lock = json.loads((ROOT / 'model-lock.json').read_text())
    expected = {item['path']: item for item in lock['files']}
    records = []
    for name in FILES:
        target = DEST / name
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f'https://huggingface.co/{REPO}/resolve/{REVISION}/{name}'
        if not target.exists():
            request = urllib.request.Request(url, headers={'User-Agent': 'Focuence-build/2.0'})
            with urllib.request.urlopen(request, timeout=90) as response:
                data = response.read()
            if name.endswith('.onnx') and len(data) < 1_000_000:
                raise ValueError('Unexpected model payload; download was not an ONNX weight file')
            target.write_bytes(data)
        data = target.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if len(data) != expected[name]['bytes'] or digest != expected[name]['sha256']:
            raise ValueError(f'{name}: checksum mismatch. Remove this file and retry the pinned download.')
        records.append({'path':name,'bytes':len(data),'sha256':digest})
        print(f'{name}: {len(data):,} bytes', flush=True)
    (DEST / 'provenance.json').write_text(json.dumps({
        'repository':REPO,'revision':REVISION,'sourceModel':'BAAI/bge-small-zh-v1.5',
        'format':'ONNX q8','files':records
    }, ensure_ascii=False, indent=2)+'\n')

if __name__ == '__main__':
    main()
