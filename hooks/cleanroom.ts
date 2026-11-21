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
// String literals are text, not data: `logger.error('invalid token')` logs no token.
export const isPiiLog = (line: string) => LOG_CALL.test(line) && RAW.test(line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""'))
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
