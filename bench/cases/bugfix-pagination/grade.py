# Pass: every test passes, the hidden ones included.
import subprocess
import sys

r = subprocess.run(['node', '--test'], cwd=sys.argv[1], capture_output=True, text=True, timeout=120)
print(r.stdout[-600:], r.stderr[-200:])
sys.exit(r.returncode)
