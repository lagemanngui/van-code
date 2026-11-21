// Migration gate: schema changes that lock a big table or break the code still running during a deploy.
// shortcut: line patterns, not a SQL parser; a statement split over lines is judged by its first line. squawk would be stricter for Postgres.

export const MIGRATION = /(^|\/)(migrations?|migrate|alembic\/versions|db\/migrate|schema\/migrations)\/.+\.(sql|py|rb|[cm]?[jt]s)$|(^|\/)migration\.sql$/

type Rule = [rx: RegExp, risk: string, safer: string]
const RULES: Rule[] = [
  // SQL
  [/\bDROP\s+COLUMN\b/i, 'drops a column the running code may still read', 'stop reading it in a deploy first, drop it in a later one'],
  [/\bRENAME\s+COLUMN\b|\bRENAME\s+TO\b/i, 'renames a column or table under the running code', 'add the new one, write both, move readers, then drop the old (expand and contract)'],
  [/\bDROP\s+TABLE\b/i, 'drops a table', 'make sure nothing reads it any more, in a deploy before this one'],
  [/\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i, 'changes a column type, which rewrites and locks the table', 'add a new column, backfill it, switch, then drop the old'],
  [/\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i, 'sets NOT NULL, which scans the whole table under a lock', 'add a CHECK (col IS NOT NULL) NOT VALID, VALIDATE it, then set NOT NULL'],
  [/\bADD\s+COLUMN\b(?!.*\bDEFAULT\b).*\bNOT\s+NULL\b/i, 'adds a NOT NULL column with no default, which fails on existing rows', 'add it nullable or with a DEFAULT, backfill, then tighten'],
  [/\bCREATE\s+(UNIQUE\s+)?INDEX\b(?!.*\bCONCURRENTLY\b)/i, 'builds an index while blocking writes', 'CREATE INDEX CONCURRENTLY (outside a transaction)'],
  [/\bADD\s+CONSTRAINT\b.*\b(FOREIGN\s+KEY|CHECK)\b(?!.*\bNOT\s+VALID\b)/i, 'adds a constraint that checks every row under a lock', 'add it NOT VALID, then VALIDATE CONSTRAINT in a separate step'],
  // Alembic
  [/\bop\.drop_column\(/, 'drops a column the running code may still read', 'stop reading it in a deploy first, drop it in a later one'],
  [/\bop\.(rename_table|alter_column\([^)]*new_column_name)/, 'renames under the running code', 'expand and contract: add, dual-write, move readers, drop'],
  [/\bop\.drop_table\(/, 'drops a table', 'make sure nothing reads it any more, in a deploy before this one'],
  [/\bop\.alter_column\([^)]*\btype_=/, 'changes a column type, which rewrites and locks the table', 'add a new column, backfill it, switch, then drop the old'],
  [/\bop\.create_index\((?![^)]*postgresql_concurrently\s*=\s*True)/, 'builds an index while blocking writes', 'postgresql_concurrently=True, in an autocommit block'],
  [/\bop\.add_column\([^)]*nullable\s*=\s*False(?![^)]*server_default)/, 'adds a NOT NULL column with no default', 'add it nullable or with server_default, backfill, then tighten'],
  // Rails
  [/^\s*remove_column\b/, 'drops a column the running code may still read', 'ignore it in the model (self.ignored_columns) first, drop it later'],
  [/^\s*(rename_column|rename_table)\b/, 'renames under the running code', 'expand and contract: add, dual-write, move readers, drop'],
  [/^\s*change_column\b/, 'changes a column type, which rewrites and locks the table', 'add a new column, backfill it, switch, then drop the old'],
  [/^\s*drop_table\b/, 'drops a table', 'make sure nothing reads it any more, in a deploy before this one'],
  [/^\s*add_index\b(?!.*algorithm:\s*:concurrently)/, 'builds an index while blocking writes', 'algorithm: :concurrently with disable_ddl_transaction!'],
  [/^\s*add_column\b(?!.*default:).*null:\s*false/, 'adds a NOT NULL column with no default', 'add it nullable or with a default, backfill, then tighten'],
  // Knex
  [/\.dropColumns?\(/, 'drops a column the running code may still read', 'stop reading it in a deploy first, drop it in a later one'],
  [/\.renameColumn\(|\.renameTable\(/, 'renames under the running code', 'expand and contract: add, dual-write, move readers, drop'],
  [/\.dropTable(IfExists)?\(/, 'drops a table', 'make sure nothing reads it any more, in a deploy before this one'],
  [/\.notNullable\(\)(?!.*\.defaultTo\()(?=.*\.alter\(\))/, 'tightens a column to NOT NULL in place', 'backfill first, then add the constraint as NOT VALID and validate'],
]

// Tables the migration itself creates: their indexes and NOT NULL columns lock nothing anyone uses yet.
function createdTables(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([\w.]+)["`]?|\bop\.create_table\(\s*['"](\w+)['"]|^\s*create_table\s+:(\w+)|\.createTable\(\s*['"](\w+)['"]/gim))
    out.add(m.slice(1).find(Boolean)!.toLowerCase().split('.').pop()!)
  return out
}

const onNewTable = (line: string, created: Set<string>) =>
  [...created].some(t => new RegExp(`\\b(ON|TABLE)\\s+["\`]?([\\w]+\\.)?${t}\\b|['":]${t}\\b`, 'i').test(line))

// Each risky line the migration adds, with the risk and a safer form.
export function migrationRisks(addedLines: string[], wholeText: string): string[] {
  const created = createdTables(wholeText)
  const out: string[] = []
  for (const line of addedLines) {
    if (/^\s*(--|#|\/\/)/.test(line)) continue
    const hit = RULES.find(([rx]) => rx.test(line))
    if (!hit || onNewTable(line, created)) continue
    out.push(`\`${line.trim().slice(0, 100)}\`: ${hit[1]}. Safer: ${hit[2]}.`)
  }
  return out
}

export const migrationNote = (file: string, risks: string[]) =>
  `[Jean-Claude Van Code] Migration gate: ${file} has statements that can lock a big table or break the code still running during a deploy:\n${risks.map(r => `- ${r}`).join('\n')}\n` +
  'If this runs against a live table, rewrite it in the safer form (expand, backfill, switch, contract). If the table is new, empty or the user asked for exactly this, tell the user in one line.'
