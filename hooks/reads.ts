// Pure helpers for the read guards: line ranges and shell commands that read files.

export type Range = [start: number, end: number] // 1-based, inclusive; end may be Infinity

export const READ_DEFAULT_LINES = 2000 // what Read returns with no limit

export function readRange(offset?: number, limit?: number): Range {
  const start = Math.max(offset ?? 1, 1)
  return [start, start + (limit ?? READ_DEFAULT_LINES) - 1]
}

// True when `r` sits inside what `ranges` already cover (touching ranges join).
export function isCovered(ranges: Range[], r: Range): boolean {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  let cur: Range | undefined
  for (const [s, e] of sorted) {
    if (cur && s <= cur[1] + 1) cur = [cur[0], Math.max(cur[1], e)]
    else {
      if (cur && cur[0] <= r[0] && r[1] <= cur[1]) return true
      cur = [s, e]
    }
  }
  return !!cur && cur[0] <= r[0] && r[1] <= cur[1]
}

export type ShellRead = {
  file: string // as written, maybe relative
  lines?: number // lines printed; undefined = the whole file
  range?: Range // known lines, for the read memory; undefined = not remembered
}

const TOKEN = /'[^']*'|"[^"]*"|\S+/g
const unquote = (t: string) => t.replace(/^(['"])(.*)\1$/, '$2')

// Leading wrappers that hide the real command.
function stripPrefixes(command: string): { rest: string; dir?: string; isBypass: boolean } {
  let rest = command.trim()
  let dir: string | undefined
  let isBypass = false
  for (;;) {
    const rtk = rest.match(/^rtk\s+(?:bypass\s+)?/)
    if (rtk) {
      isBypass ||= rtk[0].includes('bypass')
      rest = rest.slice(rtk[0].length)
      continue
    }
    const cd = rest.match(/^cd\s+('[^']*'|"[^"]*"|[^\s;&|]+)\s*(?:&&|;)\s*/)
    if (cd) {
      const to = unquote(cd[1]!)
      dir = dir && !to.startsWith('/') ? `${dir}/${to}` : to
      rest = rest.slice(cd[0].length)
      continue
    }
    return { rest, dir, isBypass }
  }
}

// The files a simple shell read prints, or undefined when it is not one.
// Pipes, redirects, chains and substitutions make it something else: left alone.
// isBypass: `rtk bypass` means the first output was unusable, so a repeat is deliberate.
export function parseShellRead(command: string): { dir?: string; isBypass: boolean; reads: ShellRead[] } | undefined {
  const { rest, dir, isBypass } = stripPrefixes(command)
  if (/[|;&<>`]|\$\(/.test(rest)) return undefined
  const tokens = (rest.match(TOKEN) ?? []).map(unquote)
  const [cmd, ...args] = tokens
  const files = (xs: string[]) => xs.filter(a => !a.startsWith('-'))
  let reads: ShellRead[] = []
  if (cmd === 'cat' || cmd === 'less' || cmd === 'more' || cmd === 'bat') {
    reads = files(args).map(file => ({ file, range: [1, Infinity] }))
  } else if (cmd === 'head' || cmd === 'tail') {
    let n = 10
    const rest: string[] = []
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!
      const m = a.match(/^-n?(\d+)$|^--lines=(\d+)$/)
      if (m) n = Number(m[1] ?? m[2])
      else if (a === '-n' || a === '-c') n = Number(args[++i]) // -c: bytes, close enough
      else rest.push(a)
    }
    if (!Number.isFinite(n)) return undefined
    reads = files(rest).map(file => ({ file, lines: n, range: cmd === 'head' ? [1, n] : undefined }))
  } else if (cmd === 'sed') {
    if (!args.includes('-n')) return undefined
    const script = args.find(a => /^\d+(,\d+)?p$/.test(a))
    if (!script) return undefined
    const [a, b = a] = script.slice(0, -1).split(',').map(Number) as [number, number?]
    const range: Range = [a, b]
    reads = files(args.filter(x => x !== script)).map(file => ({ file, lines: b - a + 1, range }))
  } else if (cmd === 'git' && args[0] === 'show') {
    // another revision's text: guarded, never remembered
    reads = args.slice(1).filter(a => /^[^-][^:]*:.+/.test(a)).map(a => ({ file: a.slice(a.indexOf(':') + 1) }))
  }
  return reads.length ? { dir, isBypass, reads } : undefined
}

export const resolvePath = (cwd: string, dir: string | undefined, file: string) =>
  file.startsWith('/') ? file : `${dir?.startsWith('/') ? dir : dir ? `${cwd}/${dir}` : cwd}/${file}`.replace(/\/\.\//g, '/')
