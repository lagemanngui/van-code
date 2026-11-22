// Clean-room check: what a turn left in the code that works here and breaks elsewhere.
// Pure helpers; the file reads and folder listings are in register.tsx.

const DEBUG = /\bconsole\.(log|debug|trace|dir)\(|^\s*debugger;?\s*$|\bbreakpoint\(\)|\bpdb\.set_trace\(|^\s*import i?pdb\b|\bdbg!\(/
const LOCALHOST = /\bhttps?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/
const ENV = /\bprocess\.env\.([A-Z_][A-Z0-9_]*)|\bprocess\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]|\bimport\.meta\.env\.([A-Z_][A-Z0-9_]*)|\bos\.(?:environ(?:\.get)?\(?\[?|getenv\()['"]([A-Z_][A-Z0-9_]*)['"]|\bos\.Getenv\("([A-Z_][A-Z0-9_]*)"\)/g
const SYSTEM_ENV = new Set(['NODE_ENV', 'CI', 'HOME', 'PATH', 'USER', 'PWD', 'TMPDIR', 'SHELL', 'TERM', 'LANG', 'DEBUG', 'MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL'])
const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\(\s*|^\s*import\s+)['"]([^'"]+)['"]/g
export const NODE_BUILTINS = new Set(
  'assert async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns domain events fs http http2 https inspector module net os path perf_hooks process punycode querystring readline repl stream string_decoder sys timers tls trace_events tty url util v8 vm wasi worker_threads zlib test'.split(' '),
)

export const isDebug = (line: string) => DEBUG.test(line)

// A log call that dumps a raw request, payload or secret: it ends up in the log store, readable by everyone with access.
const LOG_CALL = /\b(console\.(log|info|warn|error|debug)|logger\.\w+|log\.(info|warn|error|debug|trace|fatal|print\w*)|logging\.\w+|slog\.\w+|print)\s*\(/
const RAW = /\b(req|request|ctx\.request)\.(body|headers|cookies)\b|\b(event|message|msg|job)\.(payload|body|data)\b|\b(password|passwd|secret|api_?key|access_?token|refresh_?token|authorization|cookie|ssn|cpf|card_?number|credit_?card)\b/i
// String literals on one line emptied: their text is not code (an error message, a test fixture).
export const stripStrings = (text: string) => text.replace(/(['"`])(?:\\.|(?!\1)[^\n])*\1/g, '""')
// String literals are text, not data: `logger.error('invalid token')` logs no token.
export const isPiiLog = (line: string) => LOG_CALL.test(line) && RAW.test(stripStrings(line))
export const isLocalhost = (line: string) => LOCALHOST.test(line)

export function envVars(lines: string[]): string[] {
  const out = new Set<string>()
  for (const l of lines) for (const m of l.matchAll(ENV)) {
    const v = m.slice(1).find(Boolean)!
    if (!SYSTEM_ENV.has(v) && !v.startsWith('VITE_PUBLIC_') && !v.startsWith('NEXT_PUBLIC_')) out.add(v)
  }
  return [...out]
}

// Whether an env example file documents `name` (`NAME=`, `export NAME=`, or `NAME` alone on a line).
export const isDocumented = (example: string, name: string) => new RegExp(`^\\s*(export\\s+)?${name}\\s*(=|$)`, 'm').test(example)

export function importSpecs(lines: string[]): string[] {
  const out = new Set<string>()
  for (const l of lines) for (const m of l.matchAll(IMPORT)) out.add(m[1]!)
  return [...out]
}

// The package a bare import names (`@scope/x/sub` → `@scope/x`), or undefined for relative, builtin and alias imports.
export function packageOf(spec: string): string | undefined {
  if (/^(\.|\/|node:|bun:|#|~|@\/|virtual:|https?:)/.test(spec)) return undefined
  const parts = spec.split('/')
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
  return name && !NODE_BUILTINS.has(name) ? name : undefined
}

// Whether a tsconfig/jsconfig text maps `pkg` as a `paths` alias: a key `"@app/*"` or `"@app"`.
// shortcut: plain text search, so an alias only in an `extends` base config is missed; read the base too if that shows up.
export const isAlias = (pkg: string, config: string) => config.includes(`"${pkg.split('/')[0]}/`) || config.includes(`"${pkg}"`)

// Every dependency name a package.json declares.
export function declaredDeps(packageJson: string): Set<string> {
  try {
    const j = JSON.parse(packageJson) as Record<string, Record<string, string> | undefined> & { name?: string }
    const names = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(k => Object.keys(j[k] ?? {}))
    return new Set([...names, ...(j.name ? [j.name] : [])])
  } catch {
    return new Set()
  }
}

// A relative import's last part against the folder's entries: the entry it only matches ignoring case, if that is all it matches.
export function caseMiss(segment: string, entries: string[]): string | undefined {
  const stem = (n: string) => n.replace(/\.[cm]?[jt]sx?$|\.(vue|svelte|json|css|scss)$/, '')
  if (entries.some(e => e === segment || stem(e) === segment)) return undefined
  return entries.find(e => e.toLowerCase() === segment.toLowerCase() || stem(e).toLowerCase() === segment.toLowerCase())
}

export const cleanRoomNote = (items: string[]) =>
  `[Jean-Claude Van Code] Clean-room check of your last changes (they work here, and can break elsewhere):\n${items.map(i => `- ${i}`).join('\n')}\n` +
  'Fix each one, or tell the user in one line why it stays.'

// Scale traps: fine with ten rows in a test, wrong with ten thousand in production.
// Every item started at once: `Promise.all(xs.map(...))`, `asyncio.gather(*[... for ...])`.
const UNBOUNDED = /\bPromise\.all(Settled)?\(\s*[\w.$[\]]+\.map\(|\basyncio\.gather\(\s*\*\s*[[(].*\bfor\b/
export const isUnbounded = (line: string) => UNBOUNDED.test(line) && !/\blimit\w*\(|\bchunk|\bbatch|\bslice\(/i.test(line)

// A database or network call: awaited I/O, or a Django/SQLAlchemy query.
const IO_CALL =
  /\bawait\s+[\w.$]*\b(find\w*|get\w*|fetch\w*|query\w*|select\w*|load\w*|request|call|exec\w*|send|post|put|patch|delete|update\w*|insert\w*|upsert\w*|count)\s*\(|\bawait\s+(fetch|axios[\w.]*|got|db|prisma[\w.]*|knex)\b|\.objects\.(get|filter)\(|\bsession\.(query|get|execute)\(/
export const isIoCall = (line: string) => IO_CALL.test(line)
const LOOP = /^\s*(for\s*\((?!.*\bawait\b)|for\s+(?!await\b).*\b(of|in)\b|while\b)|\.(forEach|map)\(\s*(async\s*)?\(?[\w, {}]*\)?\s*=>/
const FUNCTION = /^\s*((export\s+)?(async\s+)?function\b|(async\s+)?def\b|class\b)|=>\s*\{?\s*$/
const indentOf = (l: string) => l.length - l.trimStart().length

// The loop enclosing line `i`, walking out through the blocks around it, or undefined (a function boundary stops the walk).
export function loopAround(lines: string[], i: number): number | undefined {
  let level = indentOf(lines[i]!)
  for (let j = i - 1; j >= 0 && j >= i - 12; j--) {
    const l = lines[j]!
    if (!l.trim() || indentOf(l) >= level) continue
    level = indentOf(l)
    if (LOOP.test(l)) return j
    if (FUNCTION.test(l) && !LOOP.test(l)) return undefined
  }
  return undefined
}
