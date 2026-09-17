#!/usr/bin/env python3
"""Build the bookmarklet. Stdlib only, no npm.

    python3 build.py

Reads src/, writes:
    dist/bookmarklet.js   the code as one readable script (what the test page loads)
    dist/bookmarklet.txt  the same code as a javascript: address, for pasting into a bookmark
    docs/index.html       the page people use to add the bookmark (served by GitHub Pages)
"""
from __future__ import annotations

import html
import json
import re
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC, DIST, DOCS = ROOT / "src", ROOT / "dist", ROOT / "docs"
PARTS = ["adapters/dpr-student.js", "ui.js", "main.js"]  # order matters
NAME = "Homework"


def squeeze_css(css: str) -> str:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"\s+", " ", css)
    return re.sub(r"\s*([{};:,>])\s*", r"\1", css).strip()


def squeeze_js(js: str) -> str:
    """Drop whole-line comments and indentation. Newlines stay, so there are no semicolon surprises."""
    lines = (line.strip() for line in js.splitlines())
    return "\n".join(line for line in lines if line and not line.startswith("//"))


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
    print(f"bookmarklet: {len(code):,} characters of code, {len(url):,} as a bookmark address")


if __name__ == "__main__":
    main()
