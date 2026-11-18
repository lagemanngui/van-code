# Fixture: three answers buried in a big lockfile, a big JSON and a 12-page PDF.
import json
import random
import sys
from pathlib import Path

root = Path(sys.argv[1])
rnd = random.Random(7)  # same fixture every run

# package-lock.json, ~1 MB: one package answers the first question
pkgs = {'': {'name': 'shop', 'version': '1.0.0'}}
for i in range(4000):
    name = f'pkg-{i:04d}'
    pkgs[f'node_modules/{name}'] = {
        'version': f'{rnd.randint(0, 9)}.{rnd.randint(0, 20)}.{rnd.randint(0, 30)}',
        'resolved': f'https://registry.npmjs.org/{name}/-/{name}.tgz',
        'integrity': 'sha512-' + ''.join(rnd.choice('abcdef0123456789') for _ in range(64)),
    }
pkgs['node_modules/left-pad'] = {'version': '1.3.7', 'resolved': 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.7.tgz'}
(root / 'package-lock.json').write_text(json.dumps({'name': 'shop', 'lockfileVersion': 3, 'packages': pkgs}, indent=2))
(root / 'package.json').write_text('{ "name": "shop", "version": "1.0.0", "dependencies": { "left-pad": "^1.3.0" } }\n')

# data/orders.json, ~600 KB: order 4711 answers the second question
orders = []
for i in range(1, 6001):
    lines = [{'sku': f'SKU-{rnd.randint(1, 999)}', 'qty': rnd.randint(1, 5), 'unit': rnd.randint(100, 9999) / 100} for _ in range(rnd.randint(1, 4))]
    orders.append({'id': i, 'customer': f'c{rnd.randint(1, 900)}', 'status': rnd.choice(['paid', 'shipped', 'refunded']), 'lines': lines})
orders[4710]['lines'] = [{'sku': 'SKU-42', 'qty': 3, 'unit': 19.9}, {'sku': 'SKU-7', 'qty': 1, 'unit': 40.0}]  # 3*19.9 + 40 = 99.70
(root / 'data').mkdir()
(root / 'data' / 'orders.json').write_text(json.dumps(orders, indent=2))


# docs/contract.pdf, 12 pages of text: page 9 answers the third question
def pdf(pages):
    objs = ['<< /Type /Catalog /Pages 2 0 R >>', None, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    kids = []
    for lines in pages:
        text = 'BT /F1 11 Tf 72 740 Td 14 TL ' + ' '.join(f"({l.replace('(', '').replace(')', '')}) '" for l in lines) + ' ET'
        objs.append(f'<< /Length {len(text)} >>\nstream\n{text}\nendstream')
        objs.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {len(objs)} 0 R /Resources << /Font << /F1 3 0 R >> >> >>')
        kids.append(f'{len(objs)} 0 R')
    objs[1] = f'<< /Type /Pages /Kids [{" ".join(kids)}] /Count {len(kids)} >>'
    out, offsets = '%PDF-1.4\n', []
    for n, body in enumerate(objs, 1):
        offsets.append(len(out.encode('latin-1')))
        out += f'{n} 0 obj\n{body}\nendobj\n'
    xref = len(out.encode('latin-1'))
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n' + ''.join(f'{o:010d} 00000 n \n' for o in offsets)
    out += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'
    return out.encode('latin-1')


words = 'supplier customer services agreement party obligations delivery invoice warranty liability schedule term'.split()
pages = []
for p in range(1, 13):
    lines = [f'Section {p}.{k}: ' + ' '.join(rnd.choice(words) for _ in range(10)) for k in range(1, 46)]
    if p == 9:
        lines[20] = 'Section 9.21: Either party may terminate this agreement with a notice period of 45 days.'
    pages.append(lines)
(root / 'docs').mkdir()
(root / 'docs' / 'contract.pdf').write_bytes(pdf(pages))
