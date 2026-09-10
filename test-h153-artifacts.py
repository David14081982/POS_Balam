"""Independent validation of H153 transport artifacts (stdlib PNG + PyMuPDF)."""
import sys
import json
import struct
import zlib
from pathlib import Path

root = Path(sys.argv[1])
if len(sys.argv) > 2:
    sys.path.insert(0, sys.argv[2])
import pymupdf

results = []
for path in root.glob('android-*.png'):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    offset, compressed, ended = 8, b'', False
    while offset < len(data):
        size = struct.unpack('>I', data[offset:offset + 4])[0]
        kind, chunk = data[offset + 4:offset + 8], data[offset + 8:offset + 8 + size]
        crc = struct.unpack('>I', data[offset + 8 + size:offset + 12 + size])[0]
        assert zlib.crc32(kind + chunk) & 0xffffffff == crc
        if kind == b'IHDR':
            width, height, depth, color = struct.unpack('>IIBB', chunk[:10])
            assert width == 576 and depth == 8 and color == 0
        if kind == b'IDAT':
            compressed += chunk
        if kind == b'IEND':
            ended = True
        offset += size + 12
    assert ended and offset == len(data)
    rows = zlib.decompress(compressed)
    assert len(rows) == (width + 1) * height
    dark_rows = []
    for y in range(height):
        row = rows[y * (width + 1):(y + 1) * (width + 1)]
        assert row[0] == 1
        previous, dark = 0, False
        for value in row[1:]:
            previous = (previous + value) & 255
            assert previous in (0, 255)
            dark = dark or previous == 0
        if dark:
            dark_rows.append(y)
    assert dark_rows and max(dark_rows) < height - 1
    results.append(dict(file=path.name, ok=True, width=width, height=height, lastInk=max(dark_rows)))

for path in root.glob('desktop-*.pdf'):
    doc = pymupdf.open(path)
    assert len(doc) == 1, path.name
    page = doc[0]
    assert abs(page.rect.width * 25.4 / 72 - 80) < .2
    words = page.get_text('words')
    assert words and all(w[0] >= -.5 and w[1] >= -.5 and w[2] <= page.rect.width + .5 and w[3] <= page.rect.height + .5 for w in words)
    text = page.get_text()
    # Return receipts have their own legitimate footer (refund, not store URL).
    if 'return' in path.name:
        assert 'REEMBOLSO' in text and '$1,500.00' in text
    else:
        assert 'BALAMGUAYABERAS.COM' in ''.join(text.split())
    if 'LARGO' in path.name:
        assert '24' in text and '$12,000.00' in text
    results.append(dict(file=path.name, ok=True, pages=1, words=len(words), heightMm=page.rect.height * 25.4 / 72))

for name in ['desktop-LARGO-A.pdf', 'desktop-return.pdf']:
    doc = pymupdf.open(root / name)
    doc[0].get_pixmap(matrix=pymupdf.Matrix(1.2, 1.2)).save(root / (name + '.png'))
(root / 'independent-artifacts.json').write_text(json.dumps(results, indent=2))
print(f'{len(results)}/{len(results)} independent PNG/PDF checks: {root}')
