# Fixture: a build that prints ~20,000 lines; its one real error sits in the middle.
import sys
from pathlib import Path

root = Path(sys.argv[1])
build = '''#!/bin/bash
# Builds the service. Reads its settings from config/app.yaml.
cd "$(dirname "$0")"
failed=0
for i in $(seq 1 12000); do echo "[build] compiling module_$i.o ... ok"; done
while IFS=: read -r key _; do
  case "$key" in
    ''|'#'*|name|port|timeout_s|retries) ;;
    *) echo "[build] ERROR config/app.yaml: unknown key '$key'"; failed=1 ;;
  esac
done < config/app.yaml
for i in $(seq 12001 20000); do echo "[build] linking chunk_$i ... ok"; done
if [ "$failed" = 1 ]; then echo "[build] BUILD FAILED (1 error)"; exit 1; fi
echo "[build] BUILD OK"
'''
(root / 'build.sh').write_text(build)
(root / 'build.sh').chmod(0o755)
(root / 'config').mkdir()
(root / 'config' / 'app.yaml').write_text('# service settings\nname: orders\nport: 8080\ntimeout_sec: 30\nretries: 3\n')
(root / 'README.md').write_text('# orders service\n\n`./build.sh` builds it. Settings: name, port, timeout_s (seconds), retries.\n')
