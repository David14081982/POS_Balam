"""Validate PDFs made from the exact H153 system handoffs (requires PyMuPDF)."""
import hashlib
import json
import re
import sys
from pathlib import Path

if len(sys.argv) > 2:
    sys.path.insert(0, sys.argv[2])
import pymupdf

root = Path(sys.argv[1])
manifest = json.loads((root / 'results.json').read_text(encoding='utf-8'))
assert manifest['artifacts'], 'No transport artifacts'
# Ignore layout whitespace and non-ASCII glyphs whose PDF font mapping may
# differ. Every ASCII letter/digit in every DOM line must still be recoverable.
def normalized(text):
    return re.sub('[^a-z0-9]', '', text.lower())

results = []
for artifact in manifest['artifacts']:
    path = Path(artifact['file'])
    doc = pymupdf.open(path)
    assert len(doc) == 1, (path.name, 'pagination')
    page = doc[0]
    assert abs(page.rect.width * 25.4 / 72 - 80) < .2, (path.name, 'width')
    words = page.get_text('words')
    assert words and all(w[0] >= -.5 and w[1] >= -.5 and
                        w[2] <= page.rect.width + .5 and w[3] <= page.rect.height + .5
                        for w in words), (path.name, 'clipping')
    text = normalized(page.get_text())
    lines = [normalized(line) for line in artifact['expectedText'].splitlines()]
    missing = [line for line in lines if line and line not in text]
    assert not missing, (path.name, 'missing content', missing)
    results.append(dict(file=path.name, ok=True, pages=1,
                        widthMm=page.rect.width * 25.4 / 72,
                        heightMm=page.rect.height * 25.4 / 72,
                        lines=len([line for line in lines if line]),
                        sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    if artifact['name'] in ('CORTO-B', 'LARGO-A', 'return'):
        page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(root / (path.name + '.png'))

(root / 'independent-system-artifacts.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(f'{len(results)}/{len(results)} complete system PDFs: single page, 80 mm, no clipping, every text line and footer')
