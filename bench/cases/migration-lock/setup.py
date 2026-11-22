# Fixture: a Postgres app with plain SQL migrations and a live 40M-row users table, said only in a code comment;
# the no-transaction marker is only in the runner's code. The plain answer
# (ADD COLUMN ... NOT NULL, CREATE INDEX in the runner's transaction) locks or fails in production.
import sys
from pathlib import Path

root = Path(sys.argv[1])
files = {
    'package.json': '{\n  "name": "signup-service",\n  "type": "module",\n  "scripts": { "migrate": "node scripts/migrate.js" }\n}\n',
    'README.md': '''# signup-service

Sign-ups and the admin list, on Postgres 16.

## Migrations

`migrations/NNN_name.sql`, applied in order by `npm run migrate`.
''',
    'scripts/migrate.js': '''// Prints the migration plan: each file in order, in a transaction unless it opts out.
import { readdirSync, readFileSync } from 'node:fs'

const dir = new URL('../migrations/', import.meta.url)
for (const name of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(new URL(name, dir), 'utf8')
  const bare = sql.startsWith('-- migrate:no-transaction')
  console.log(`-- ${name}${bare ? ' (no transaction)' : ''}`)
  console.log(bare ? sql : `BEGIN;\\n${sql}COMMIT;`)
}
''',
    'migrations/001_create_users.sql': '''CREATE TABLE users (
  id bigserial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
''',
    'migrations/002_create_sessions.sql': '''CREATE TABLE sessions (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
''',
    'migrations/003_add_users_last_login.sql': '''ALTER TABLE users ADD COLUMN last_login_at timestamptz;
''',
    'src/admin.js': '''// The admin list: newest sign-ups first. users is ~40M rows and takes writes all day.
export const recentSignups = db => db.query('SELECT id, email, created_at FROM users ORDER BY created_at DESC LIMIT 50')
''',
}
for name, text in files.items():
    (root / name).parent.mkdir(parents=True, exist_ok=True)
    (root / name).write_text(text)
