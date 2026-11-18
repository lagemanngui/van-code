# Pass: all three answers right.
import re
import sys
from pathlib import Path

want = {'lockfile': '1.3.7', 'order': '99.70', 'notice': '45'}
try:
    text = (Path(sys.argv[1]) / 'ANSWER.txt').read_text()
except FileNotFoundError:
    print('no ANSWER.txt')
    sys.exit(1)
got = {k: v.strip() for k, v in re.findall(r'^\s*(lockfile|order|notice)\s*:\s*(.+)$', text, re.M)}
wrong = {k: got.get(k) for k, v in want.items() if re.sub(r'\s*days?$', '', got.get(k, '')) != v}
print('wrong:', wrong if wrong else 'none')
sys.exit(1 if wrong else 0)
