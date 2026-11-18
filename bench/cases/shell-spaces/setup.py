# Fixture: a backup script that breaks on file names with spaces (shellcheck flags it).
import sys
from pathlib import Path

root = Path(sys.argv[1])
script = '''#!/bin/bash
# Usage: backup.sh <src dir> <dest dir>
# Copies every .txt file in <src dir> to <dest dir>, adding a .bak suffix.
SRC=$1
DEST=$2
mkdir -p $DEST
count=0
for f in $(ls $SRC | grep '\\.txt$'); do
  cp $SRC/$f $DEST/$f.bak
  count=$((count + 1))
done
echo "backed up $count files"
'''
(root / 'scripts').mkdir()
(root / 'scripts' / 'backup.sh').write_text(script)
(root / 'scripts' / 'backup.sh').chmod(0o755)
(root / 'notes').mkdir()
for name in ['todo.txt', 'ideas.txt']:
    (root / 'notes' / name).write_text(f'{name}\n')
(root / 'README.md').write_text('# notes\n\n`scripts/backup.sh notes backup` backs up the notes.\n')
