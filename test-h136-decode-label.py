"""Lee las barras del PDF con ZXing, independientemente del generador de BALAM.
Requiere PyMuPDF, Pillow y zxing-cpp instalados fuera del repositorio.
"""
import json
import sys
import pymupdf as fitz
import zxingcpp
from PIL import Image

with fitz.open(sys.argv[1]) as document:
    codes = set()
    text = []
    for page in document:
        text.append(page.get_text())
        bitmap = page.get_pixmap(matrix=fitz.Matrix(4, 4), alpha=False)
        raster = Image.frombytes("RGB", [bitmap.width, bitmap.height], bitmap.samples)
        codes.update(result.text for result in zxingcpp.read_barcodes(raster))
    print(json.dumps({"codes": sorted(codes), "text": "\n".join(text)}))
