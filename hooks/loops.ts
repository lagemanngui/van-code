// Loop detector: failing shell commands that are variants of one attempt (same tool and
// subcommand, or the same error), so `pnpm test` then `DATABASE_URL=x pnpm test` is one streak.
export type Attempt = { command: string; key: string; error: string }

const PREFIX = /^(rtk|bypass|sudo|env|time|npx|bunx|exec|command)$/
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/

// The tool and its subcommand of the last segment that is not a `cd`: `cd x && FOO=1 pnpm test -w` is `pnpm test`.
// shortcut: whitespace tokens, so quoted arguments split wrongly; fine for a tool and its verb.
export function commandKey(command: string): string {
  const segs = command.split(/&&|\|\||;|\n/).map(s => s.trim().split(/\s+/).filter(Boolean))
  const seg = segs.filter(t => t.length > 0 && t[0] !== 'cd').at(-1) ?? []
  let i = 0
  while (i < seg.length && (PREFIX.test(seg[i]!) || ASSIGN.test(seg[i]!))) i++
  const bin = seg[i]?.slice(seg[i]!.lastIndexOf('/') + 1) ?? ''
  const sub = seg.slice(i + 1).find(t => !t.startsWith('-')) ?? ''
  return `${bin} ${sub}`.trim()
}

// The line of the output that names the failure, numbers blanked so ports, lines and timings
// do not make the same error look new.
export function errorLine(output: string): string {
  const lines = output.split('\n').map(l => l.trim()).filter(Boolean)
  const line = lines.find(l => /error|fail|refused|denied|not found|no such|cannot|unable|missing|invalid|in use/i.test(l)) ?? lines.at(-1) ?? ''
  return line.slice(0, 200)
}
const sig = (error: string) => error.replace(/\d+/g, 'N')

// The streak after one more failure: it goes on when the failure is related to the last one.
export function nextStreak(streak: Attempt[], failed: Attempt): Attempt[] {
  const last = streak.at(-1)
  const isRelated = last !== undefined && (last.key === failed.key || (failed.error !== '' && sig(last.error) === sig(failed.error)))
  return isRelated ? [...streak, failed] : [failed]
}

export function loopNote(streak: Attempt[]): string {
  const tried = streak.map((a, n) => `${n + 1}. \`${a.command.slice(0, 160)}\` → ${a.error || 'no error text'}`)
  return [
    `[Jean-Claude Van Code] ${streak.length} related commands failed in a row:`,
    ...tried,
    'Stop retrying variants. Say in one line what each attempt ruled out, find the cause these errors point to, and change the approach, or tell the user what blocks you.',
  ].join('\n')
}
