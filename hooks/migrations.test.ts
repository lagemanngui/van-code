import { expect, test } from 'claude-code/testing'

import { MIGRATION, migrationRisks } from './migrations.js'

const risky = (lines: string[], whole = lines.join('\n')) => migrationRisks(lines, whole).map(r => r.split('`: ')[1]!.split('.')[0])

test('migration files are recognised across frameworks', () => {
  expect(['/r/db/migrate/20240101_add.rb', '/r/prisma/migrations/2024_x/migration.sql', '/r/alembic/versions/ab12_users.py', '/r/migrations/003.sql', '/r/src/users.sql'].map(f => MIGRATION.test(f))).toEqual([true, true, true, true, false])
})

test('statements that lock or break a live table are flagged, with a safer form', () => {
  expect(risky(['ALTER TABLE users DROP COLUMN legacy_id;'])).toEqual(['drops a column the running code may still read'])
  expect(risky(['ALTER TABLE users ADD COLUMN plan text NOT NULL;'])).toEqual(['adds a NOT NULL column with no default, which fails on existing rows'])
  expect(risky(["ALTER TABLE users ADD COLUMN plan text NOT NULL DEFAULT 'free';"])).toEqual([])
  expect(risky(['CREATE INDEX idx_users_email ON users (email);'])).toEqual(['builds an index while blocking writes'])
  expect(risky(['CREATE INDEX CONCURRENTLY idx_users_email ON users (email);'])).toEqual([])
  expect(risky(['ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;'])).toEqual([])
  expect(risky(["    op.drop_column('users', 'legacy_id')"])).toEqual(['drops a column the running code may still read'])
  expect(risky(['    add_index :users, :email'])).toEqual(['builds an index while blocking writes'])
  expect(risky(['    add_index :users, :email, algorithm: :concurrently'])).toEqual([])
  expect(risky(['-- DROP COLUMN legacy_id later'])).toEqual([]) // a comment
})

test('a table the migration itself creates locks nothing anyone uses', () => {
  const whole = 'CREATE TABLE invoices (id bigint primary key, total numeric NOT NULL);\nCREATE INDEX idx_invoices_total ON invoices (total);'
  expect(migrationRisks(['CREATE INDEX idx_invoices_total ON invoices (total);'], whole)).toEqual([])
})

test('a risky migration edit gets the gate note on its result, once', async ($, on) => {
  on('fs.read', () => ({ value: 'ALTER TABLE users DROP COLUMN legacy_id;' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} }))
  const edit = () => $.tool.call({ tool: 'Edit', file_path: '/r/migrations/004.sql', old_string: '', new_string: 'ALTER TABLE users DROP COLUMN legacy_id;' } as never)
  expect(((await edit()).context ?? []).join('\n')).toContain('Migration gate: /r/migrations/004.sql')
  expect(((await edit()).context ?? []).join('\n')).not.toContain('Migration gate')
})
