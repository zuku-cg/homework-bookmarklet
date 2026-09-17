#!/usr/bin/env python3
"""Build the bookmarklet. Stdlib only, no npm.

    python3 build.py

Reads src/, writes:
    dist/bookmarklet.js   the code as one readable script (what the test page loads)
    dist/bookmarklet.txt  the same code as a javascript: address, for pasting into a bookmark
    docs/index.html       the page people use to add the bookmark (served by GitHub Pages)
    extension/            the browser extension, ready for "Load unpacked" (same view code as the bookmark)
    dist/homework-extension.zip   the extension zipped for the Chrome Web Store
"""
from __future__ import annotations

import html
import json
import re
import shutil
import struct
import urllib.parse
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC, DIST, DOCS = ROOT / "src", ROOT / "dist", ROOT / "docs"
PARTS = ["adapters/dpr-student.js", "ui.js", "main.js"]  # order matters
NAME = "Homework"
VERSION = "0.1.0"  # the extension's version; bump it for every store upload
EXT = ROOT / "extension"


def squeeze_css(css: str) -> str:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"\s+", " ", css)
    return re.sub(r"\s*([{};:,>])\s*", r"\1", css).strip()


def squeeze_js(js: str) -> str:
    """Drop whole-line comments and indentation. Newlines stay, so there are no semicolon surprises."""
    lines = (line.strip() for line in js.splitlines())
    return "\n".join(line for line in lines if line and not line.startswith("//"))


def icon_png(size: int) -> bytes:
    """The icon: a dark rounded square, a highlighter stripe and a white tick. Drawn here so there are no image files to keep."""
    ink, hl, white = (24, 38, 59), (246, 211, 74), (255, 255, 255)
    ss = 4  # supersample for smooth edges
    n = size * ss

    def seg_dist(px, py, ax, ay, bx, by):
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5

    def sample(x, y):  # x, y in 0..1
        r = 0.22
        cx, cy = min(max(x, r), 1 - r), min(max(y, r), 1 - r)
        if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
            return (0, 0, 0, 0)
        tick = min(seg_dist(x, y, 0.27, 0.52, 0.43, 0.68), seg_dist(x, y, 0.43, 0.68, 0.74, 0.33))
        if tick < 0.065:
            return (*white, 255)
        if 0.16 < x < 0.84 and 0.60 < y < 0.80:
            return (*hl, 255)
        return (*ink, 255)

    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            acc = [0, 0, 0, 0]
            for sj in range(ss):
                for si in range(ss):
                    c = sample((i * ss + si + 0.5) / n, (j * ss + sj + 0.5) / n)
                    a = c[3]
                    acc[0] += c[0] * a; acc[1] += c[1] * a; acc[2] += c[2] * a; acc[3] += a
            a = acc[3]
            row += bytes([acc[0] // a, acc[1] // a, acc[2] // a, a // (ss * ss)] if a else [0, 0, 0, 0])
        rows.append(bytes(row))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


def build_extension(code: str) -> None:
    if EXT.exists():
        shutil.rmtree(EXT)
    (EXT / "icons").mkdir(parents=True)
    (EXT / "view.js").write_text(code + "\n")
    shutil.copy(SRC / "extension" / "background.js", EXT / "background.js")
    manifest = (SRC / "extension" / "manifest.template.json").read_text().replace("{{VERSION}}", VERSION)
    json.loads(manifest)  # fail the build on a typo
    (EXT / "manifest.json").write_text(manifest)
    for size in (16, 32, 48, 128):
        (EXT / "icons" / f"{size}.png").write_bytes(icon_png(size))
    with zipfile.ZipFile(DIST / "homework-extension.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(EXT.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(EXT))


def main() -> None:
    css = squeeze_css((SRC / "ui.css").read_text())
    js = "\n".join((SRC / p).read_text() for p in PARTS)
    js = js.replace("__CSS__", json.dumps(css))
    code = "(() => {\n\"use strict\";\n" + squeeze_js(js) + "\n})();"

    DIST.mkdir(exist_ok=True)
    (DIST / "bookmarklet.js").write_text(code + "\n")
    url = "javascript:" + urllib.parse.quote(code, safe="~()*!.'-_")
    (DIST / "bookmarklet.txt").write_text(url)

    page = (SRC / "install.template.html").read_text()
    page = page.replace("{{NAME}}", html.escape(NAME)).replace("{{HREF}}", html.escape(url, quote=True))
    DOCS.mkdir(exist_ok=True)
    (DOCS / "index.html").write_text(page)
    build_extension(code)
    print(f"bookmarklet: {len(code):,} characters of code, {len(url):,} as a bookmark address")
    print(f"extension {VERSION}: extension/ and dist/homework-extension.zip")


if __name__ == "__main__":
    main()
