#!/usr/bin/env python3
"""Build the public website from an explicit asset allowlist, with no dependencies."""
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "website"
OUTPUT = ROOT / "dist" / "website"
BASE = "/Focuence"


def build():
    # Never package repository roots, model files, reports, or local settings.
    if OUTPUT.is_symlink():
        raise SystemExit("Refusing to replace a symlinked website output")
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    assets = OUTPUT / "assets"
    assets.mkdir(parents=True)
    html = (SOURCE / "index.html").read_text(encoding="utf-8")
    for source_name, placeholder in [("styles.css", "__STYLESHEET__"), ("main.js", "__SCRIPT__")]:
        content = (SOURCE / source_name).read_bytes()
        digest = hashlib.sha256(content).hexdigest()[:12]
        name = Path(source_name)
        built_name = f"{name.stem}.{digest}{name.suffix}"
        (assets / built_name).write_bytes(content)
        html = html.replace(placeholder, f"{BASE}/assets/{built_name}")
    shutil.copyfile(ROOT / "icons" / "icon-128.png", assets / "icon.png")
    if "__STYLESHEET__" in html or "__SCRIPT__" in html:
        raise SystemExit("Unresolved website asset reference")
    (OUTPUT / "index.html").write_text(html, encoding="utf-8")
    hashes = {str(p.relative_to(OUTPUT)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(OUTPUT.rglob("*")) if p.is_file()}
    release = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()[:12]
    manifest = {"release": f"focuence-site-{release}", "basePath": BASE, "files": hashes}
    (OUTPUT / "release.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "release": manifest["release"], "files": len(hashes) + 1}, ensure_ascii=False))


if __name__ == "__main__":
    build()
