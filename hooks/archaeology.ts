// Archaeology: lines an edit removes that a fix put there. Code that looks odd is often a bug's scar.

// A commit summary that reads as a fix, a workaround or a tracked issue. "fix" only leads it (`fix:`, `Fix the race`):
// mid-sentence it is often a feature describing itself ("shows what was fixed").
const FIX = /^\s*(\w+(\([^)]*\))?!?:\s*)?(fix(e[sd])?|hotfix|revert(s|ed)?)\b|\b(bug|race|workaround|hack|regression|prevent(s|ed)?|security|cve-\d+|edge case|crash(es)?)\b|#\d+/i

// The lines of `before` that `after` no longer has, trimmed.
export function removedLines(before: string, after: string): Set<string> {
  const kept = new Set(after.split('\n').map(l => l.trim()))
  // a bare `}` or `);` is in every commit: only lines with a word in them count
  return new Set(before.split('\n').map(l => l.trim()).filter(l => /\w{2}/.test(l) && !kept.has(l)))
}

type Blamed = { hash: string; summary: string; line: number; text: string }

// `git blame --porcelain` output, one entry per line.
export function parseBlame(out: string): Blamed[] {
  const summaries = new Map<string, string>()
  const rows: Blamed[] = []
  let hash = ''
  let line = 0
  for (const l of out.split('\n')) {
    const head = l.match(/^([0-9a-f]{40}) \d+ (\d+)/)
    if (head) {
      hash = head[1]!
      line = Number(head[2])
    } else if (l.startsWith('summary ')) summaries.set(hash, l.slice(8))
    else if (l.startsWith('\t')) rows.push({ hash, summary: '', line, text: l.slice(1) })
  }
  return rows.map(r => ({ ...r, summary: summaries.get(r.hash) ?? '' }))
}

// The fix commits behind the removed lines, each with the lines it owns.
export function fixesRemoved(blamed: Blamed[], removed: Set<string>): { hash: string; summary: string; lines: number[] }[] {
  const by = new Map<string, { hash: string; summary: string; lines: number[] }>()
  for (const b of blamed) {
    // a merge names the PR it merged (#12), not a fix
    if (/^0+$/.test(b.hash) || !removed.has(b.text.trim()) || !FIX.test(b.summary) || /^Merge\b/.test(b.summary)) continue
    const e = by.get(b.hash) ?? { hash: b.hash.slice(0, 7), summary: b.summary, lines: [] }
    e.lines.push(b.line)
    by.set(b.hash, e)
  }
  return [...by.values()]
}

const span = (ls: number[]) => (ls.length === 1 ? `L${ls[0]}` : `L${Math.min(...ls)}-${Math.max(...ls)}`)

export const archaeologyNote = (file: string, fixes: { hash: string; summary: string; lines: number[] }[]) =>
  `[Jean-Claude Van Code] Archaeology: this edit of ${file} removed lines that came from fixes: ` +
  fixes.map(f => `\`${f.hash}\` "${f.summary}" (${span(f.lines)})`).join('; ') +
  '. Check the removal does not bring that bug back (`git show <hash>` has the why). If it is safe, tell the user in one line.'
