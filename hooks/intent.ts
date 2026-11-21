// Intent diff: what a turn changed that the person never asked for.
// Deterministic part: dependencies added by a manifest edit or an install command, not named in the request.

export const MANIFEST = /(^|\/)(package\.json|requirements[\w.-]*\.txt|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile)$/
const NOT_DEP = new Set(['name', 'version', 'edition', 'description', 'license', 'authors', 'main', 'type', 'private', 'go', 'module', 'python', 'readme', 'node', 'npm', 'pnpm', 'yarn', 'bun'])

// shortcut: line patterns, not a manifest parser; a dependency added mid-line or in an odd layout is missed.
function depsIn(file: string, text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    let m: RegExpMatchArray | null = null
    if (/package\.json$/.test(file)) m = line.match(/^\s*"(@?[\w.-]+(?:\/[\w.-]+)?)":\s*"(?:[\^~>=<]*\d|workspace:|npm:|github:|git\+|https?:|file:|latest)/)
    else if (/\.txt$/.test(file)) m = line.match(/^\s*([A-Za-z0-9][\w.-]*)\s*(?:\[[^\]]*\])?\s*(?:[=<>~!]=|>|<|$)/)
    else if (/pyproject\.toml$/.test(file)) m = line.match(/^\s*"([A-Za-z0-9][\w.-]*)\s*(?:\[[^\]]*\])?\s*[=<>~!]/) ?? line.match(/^\s*([A-Za-z0-9][\w-]*)\s*=\s*("[\^~=]?\d|\{)/)
    else if (/go\.mod$/.test(file)) m = line.match(/^\s*(?:require\s+)?([\w.-]+\.[\w]+\/[\w./-]+)\s+v\d/)
    else if (/Cargo\.toml$/.test(file)) m = line.match(/^\s*([\w-]+)\s*=\s*("[\^~=]?\d|\{)/)
    else if (/Gemfile$/.test(file)) m = line.match(/^\s*gem\s+['"]([\w.-]+)['"]/)
    if (m && !NOT_DEP.has(m[1]!.toLowerCase())) out.push(m[1]!)
  }
  return out
}

// Dependencies `after` has that `before` does not.
export function addedDeps(file: string, before: string, after: string): string[] {
  const had = new Set(depsIn(file, before))
  return [...new Set(depsIn(file, after))].filter(d => !had.has(d))
}

// Packages an install command adds: `npm i x`, `pnpm add x`, `pip install x`, `cargo add x`, `go get x`, `bundle add x`.
export function installedDeps(command: string): string[] {
  const out: string[] = []
  for (const seg of command.split(/&&|\|\||[;|\n]/)) {
    const t = seg.trim().split(/\s+/)
    const i = t.findIndex((w, j) =>
      (/^(npm|pnpm|yarn|bun)$/.test(w) && /^(i|install|add)$/.test(t[j + 1] ?? '')) ||
      (/^(pip3?|uv|poetry)$/.test(w) && /^(install|add)$/.test(t[j + 1] ?? '')) ||
      (/^(cargo|bundle)$/.test(w) && t[j + 1] === 'add') ||
      (w === 'go' && t[j + 1] === 'get'),
    )
    if (i === -1) continue
    const args = t.slice(i + 2)
    if (args.some(a => a === '-r' || a.startsWith('--requirement'))) continue // installs a file's list, not new names
    for (const raw of args) {
      const a = raw.replace(/^['"]|['"]$/g, '')
      if (a.startsWith('-') || a === 'pip' || a === '.' || /^\.?\//.test(a)) continue
      // strip a version: `x@1.2`, `@scope/x@^2`, `x==1.0`, `x>=2`, `mod@v1.2.3`
      const name = a.replace(/(?<=.)@[^/]*$/, '').replace(/[=<>~!].*$/, '').replace(/\[.*\]$/, '')
      if (name) out.push(name)
    }
  }
  return out
}

// Named in the request: the full name, or its last part (`react-query` for `@tanstack/react-query`).
export function isNamed(dep: string, request: string): boolean {
  const text = request.toLowerCase()
  const d = dep.toLowerCase()
  const tail = d.slice(d.lastIndexOf('/') + 1)
  return text.includes(d) || (tail.length >= 3 && text.includes(tail))
}

export const depNote = (deps: string[], where: string) =>
  `[Jean-Claude Van Code] Intent diff: ${where} added ${deps.length > 1 ? 'dependencies' : 'a dependency'} the request never named: ${deps.map(d => `\`${d}\``).join(', ')}. ` +
  'If the standard library or something already installed does the job, use that and remove it. If it is needed, tell the user why in one line.'

// Model part: the request against the turn's changes, for big turns.
export const INTENT_SYSTEM = `You compare what a developer asked their coding assistant for with the code changes the assistant made in one turn.
List only clear mismatches:
- Unasked: a feature, option, config setting, abstraction, dependency or file the request does not need.
- Missing: a part of the request the changes plainly do not address.
You see only the changes, not the rest of the code: never claim something is missing if it could live in code you cannot see.
Tests, types and docs for what was asked are not unasked.
If everything matches, answer exactly: NONE
Otherwise at most 4 short lines, each starting with "Unasked:" or "Missing:".`

// The model's lines, or undefined when it found nothing.
export function intentFindings(text: string): string | undefined {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => /^(Unasked|Missing):/.test(l))
  return /^NONE\b/.test(text.trim()) || lines.length === 0 ? undefined : lines.slice(0, 4).join('\n')
}
