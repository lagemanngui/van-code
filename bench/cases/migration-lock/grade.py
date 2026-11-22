# Pass: the new migrations add email_verified as a NOT NULL column defaulting to false without locking users,
# and build the (email_verified, created_at) index CONCURRENTLY in a file the runner leaves outside a transaction.
# Fails: NOT NULL with no default, SET NOT NULL or a full-table UPDATE on users, an index that blocks writes,
# CONCURRENTLY inside a transaction, or an edited old migration.
import re
import subprocess
import sys
from pathlib import Path

work = Path(sys.argv[1])
problems = []
git = lambda *a: subprocess.run(['git', *a], cwd=work, capture_output=True, text=True).stdout

if git('diff', '--name-only', 'HEAD', '--', 'migrations/').strip():
    problems.append('an existing migration was edited')
new = sorted(work / p for p in git('ls-files', '--others', '--exclude-standard', '--', 'migrations/').split() if p.endswith('.sql'))
if not new:
    problems.append('no new migration file')

column = index = False
for f in new:
    text = f.read_text()
    bare = text.startswith('-- migrate:no-transaction')
    sql = re.sub(r'--[^\n]*', '', text)
    for st in (s.strip() for s in sql.split(';')):
        one = ' '.join(st.split())
        if not one:
            continue
        if re.search(r'\b(BEGIN|COMMIT|START TRANSACTION)\b', one, re.I) and bare:
            problems.append(f'{f.name} opens a transaction of its own')
        if re.search(r'\bADD\s+COLUMN\b.*\bemail_verified\b', one, re.I):
            column = True
            if re.search(r'\bNOT\s+NULL\b', one, re.I) and not re.search(r'\bDEFAULT\s+false\b', one, re.I):
                problems.append('email_verified is NOT NULL with no DEFAULT false')
            if re.search(r'\bDEFAULT\s+true\b', one, re.I):
                problems.append('existing users default to verified')
            if not re.search(r'\bNOT\s+NULL\b', one, re.I):
                problems.append('email_verified is not required (nullable)')
        if re.search(r'\bSET\s+NOT\s+NULL\b', one, re.I):
            problems.append('SET NOT NULL scans 40M rows under a lock')
        if re.search(r'^UPDATE\s+"?users"?\b', one, re.I) and not re.search(r'\bWHERE\b', one, re.I):
            problems.append('a full-table UPDATE of users')
        if re.search(r'\bCREATE\s+(UNIQUE\s+)?INDEX\b.*\bON\s+"?users"?\b.*\bemail_verified\b', one, re.I):
            index = True
            if not re.search(r'\bCONCURRENTLY\b', one, re.I):
                problems.append('the index blocks writes to users (no CONCURRENTLY)')
            elif not bare:
                problems.append(f'CREATE INDEX CONCURRENTLY in {f.name}, which the runner wraps in a transaction')
            if not re.search(r'\(\s*"?email_verified"?\s*,\s*"?created_at"?', one, re.I):
                problems.append('the index is not on (email_verified, created_at)')
if new and not column:
    problems.append('email_verified is never added')
if new and not index:
    problems.append('no index on users with email_verified')

print('problems:', sorted(set(problems)) or 'none')
sys.exit(1 if problems else 0)
