# Pass: the script backs up every .txt file, whatever the names, and nothing else.
import subprocess
import sys
import tempfile
from pathlib import Path

work = Path(sys.argv[1])
names = ['plain.txt', 'meeting notes.txt', 'two  spaces.txt', '[draft]*.txt', '-dash.txt', 'skip.md']
with tempfile.TemporaryDirectory() as t:
    src, dest = Path(t) / 'my notes', Path(t) / 'back up'
    src.mkdir()
    for n in names:
        (src / n).write_text(f'content of {n}\n')
    r = subprocess.run(['bash', str(work / 'scripts' / 'backup.sh'), str(src), str(dest)], capture_output=True, text=True, timeout=60)
    print('exit', r.returncode, r.stdout[-300:], r.stderr[-300:])
    want = {f'{n}.bak' for n in names if n.endswith('.txt')}
    got = {p.name for p in dest.iterdir()} if dest.exists() else set()
    bad = [n for n in want if n in got and (dest / n).read_text() != f'content of {n[:-4]}\n']
    print('missing', sorted(want - got), 'extra', sorted(got - want), 'wrong content', bad)
    sys.exit(0 if r.returncode == 0 and got == want and not bad else 1)
