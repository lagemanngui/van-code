# Pass: every part of the feature works (hidden tests), the whole suite passes, and the tests that the feature
# does not change still pass as committed (adding or strengthening tests is fine). The CSV test's header line may change: the feature changes the header.
import subprocess
import sys
from pathlib import Path

work = Path(sys.argv[1])
problems = []
run = lambda *c: subprocess.run(list(c), cwd=work, capture_output=True, text=True, timeout=300)

hidden = run('node', '--test', 'test/hidden-currency.test.js')
for line in hidden.stdout.splitlines():
    if line.startswith('not ok') and 'hidden:' in line:
        problems.append(line.split('hidden: ', 1)[1].strip())
if hidden.returncode != 0 and not problems:
    problems.append('the hidden tests do not run')

# the tests the feature leaves alone, as committed, must still pass: strengthening them is fine, weakening is not
for t in ('test/cart.test.js', 'test/catalog.test.js', 'test/handlers.test.js'):
    original = work / 'test' / ('original-' + t.split('/')[1])
    original.write_text(run('git', 'show', f'HEAD:{t}').stdout)
    if run('node', '--test', str(original.relative_to(work))).returncode != 0:
        problems.append(f'{t} as committed fails against the change')
    original.unlink()

suite = run('node', '--test')
if suite.returncode != 0:
    problems.append('npm test fails')

print('problems:', problems or 'none')
sys.exit(1 if problems else 0)
