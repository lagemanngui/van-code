import type { EngineInterface } from 'claude-code'

import { cwd, run } from './factory.js'

// Post-edit check: the language's own fast checker on the edited file; errors ride
// back on the edit's result. Zero tokens when clean.
const CHECK_TIMEOUT = 30_000
const CHECK_LINES = 20

async function exists($: EngineInterface, path: string) {
  try {
    await $.fs.stat(path)
    return true
  } catch {
    return false
  }
}

// Nearest folder at or above `dir` holding `name`, up to the filesystem root.
async function findUp($: EngineInterface, dir: string, name: string): Promise<string | undefined> {
  for (let d = dir; d.length > 1; d = d.slice(0, d.lastIndexOf('/')) || '/') {
    if (await exists($, `${d}/${name}`)) return d
  }
  return undefined
}

export const dirOf = (file: string) => file.slice(0, file.lastIndexOf('/')) || '/'

// Answers which checker ran, whether it passed outright, and its error lines about `file`;
// undefined when nothing could check it.
export async function checkFile(
  $: EngineInterface,
  file: string,
): Promise<{ tool: string; isClean: boolean; errors?: string } | undefined> {
  const pick = (out: string) =>
    out
      .split('\n')
      .filter(l => l.includes(file) || l.includes(file.slice(file.lastIndexOf('/') + 1)))
      .slice(0, CHECK_LINES)
      .join('\n')
  const opts = (cwd: string) => ({ cwd, timeoutMs: CHECK_TIMEOUT })
  const exec = async (argv: string[], cwd: string) => {
    try {
      const r = await $.process.run(argv, opts(cwd))
      return { code: r.exitCode, out: r.stdout + r.stderr }
    } catch {
      return undefined // missing tool or timed out: no verdict
    }
  }

  if (/\.(ts|tsx|mts|cts)$/.test(file)) {
    // shortcut: whole-project tsc filtered to this file; slow projects hit the timeout and go unchecked.
    const root = await findUp($, dirOf(file), 'tsconfig.json')
    if (!root || !(await exists($, `${root}/node_modules/.bin/tsc`))) return undefined
    // --incremental reuses the last run's types (0.34 s to 0.06 s on this repo); its build info goes
    // to the session scratchpad, never into the user's project. No scratchpad: a full run, as before.
    const scratch = await $.session.info().then(i => i.scratchpadDir).catch(() => undefined)
    const incremental = scratch ? ['--incremental', '--tsBuildInfoFile', `${scratch}/van-code-tsc${root.replace(/\W/g, '_')}.tsbuildinfo`] : []
    const r = await exec([`${root}/node_modules/.bin/tsc`, '--noEmit', '--pretty', 'false', ...incremental, '-p', root], root)
    if (!r) return undefined
    // errors only in other files: not clean, but nothing to report about this one
    return { tool: 'tsc', isClean: r.code === 0, errors: r.code === 0 ? undefined : pick(r.out) || undefined }
  }
  if (/\.py$/.test(file)) {
    const ruff = await exec(['ruff', 'check', '--output-format', 'concise', file], dirOf(file))
    if (ruff && ruff.code !== undefined && !/command not found/.test(ruff.out)) {
      return { tool: 'ruff', isClean: ruff.code === 0, errors: ruff.code === 0 ? undefined : pick(ruff.out) || ruff.out.slice(0, 2000) }
    }
    const py = await exec(['python3', '-m', 'py_compile', file], dirOf(file))
    return py && { tool: 'py_compile', isClean: py.code === 0, errors: py.code === 0 ? undefined : py.out.slice(0, 2000) }
  }
  if (/\.go$/.test(file)) {
    const r = await exec(['go', 'vet', '.'], dirOf(file))
    return r && { tool: 'go vet', isClean: r.code === 0, errors: r.code === 0 ? undefined : pick(r.out) || r.out.slice(0, 2000) }
  }
  if (/\.(sh|bash)$/.test(file)) {
    const r = await exec(['bash', '-n', file], dirOf(file))
    if (!r || r.code !== 0) return r && { tool: 'bash -n', isClean: false, errors: r.out.slice(0, 2000) }
    // syntax is fine: shellcheck, when installed, finds the real bugs (warnings and up, no style notes)
    const sc = await exec(['shellcheck', '-S', 'warning', '-f', 'gcc', file], dirOf(file))
    if (!sc) return { tool: 'bash -n', isClean: true }
    return { tool: 'shellcheck', isClean: sc.code === 0, errors: sc.code === 0 ? undefined : sc.out.slice(0, 2000) }
  }
  if (/\.(tf|tofu)$/.test(file)) {
    // validate needs `init` (providers); without it, fmt still parses and catches syntax errors
    const isInit = await exists($, `${dirOf(file)}/.terraform`)
    for (const bin of ['terraform', 'tofu']) {
      const r = isInit
        ? await exec([bin, 'validate', '-no-color'], dirOf(file))
        : await exec([bin, 'fmt', '-no-color', '-write=false', '-list=false', file], dirOf(file))
      if (!r) continue // not installed: try the next
      return { tool: `${bin} ${isInit ? 'validate' : 'fmt'}`, isClean: r.code === 0, errors: r.code === 0 ? undefined : r.out.slice(0, 2000) }
    }
    return undefined
  }
  if (/\.ya?ml$/.test(file)) {
    // a chart's templates are Go templates, not YAML: lint the whole chart
    const chart = await findUp($, dirOf(file), 'Chart.yaml')
    if (chart) {
      const r = await exec(['helm', 'lint', chart], chart)
      return r && { tool: 'helm lint', isClean: r.code === 0, errors: r.code === 0 ? undefined : r.out.split('\n').filter(l => /\[(ERROR|WARNING)\]|Error/.test(l)).slice(0, CHECK_LINES).join('\n') || r.out.slice(0, 2000) }
    }
    // only Kubernetes manifests: a workflow or compose file has no apiVersion and kind
    const text = await $.fs.read(file).catch(() => '')
    if (!/^apiVersion:/m.test(text) || !/^kind:/m.test(text)) return undefined
    const r = await exec(['kubeconform', '-strict', '-ignore-missing-schemas', '-summary=false', file], dirOf(file))
    return r && { tool: 'kubeconform', isClean: r.code === 0, errors: r.code === 0 ? undefined : r.out.slice(0, 2000) }
  }
  return undefined // shortcut: Rust and others unchecked; cargo check is too slow per edit.
}

// Test selector: which tests reach a changed file through imports, found by git grep.
export const IS_TEST = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/
const IMPORT_DEPTH = 4

const stemOf = (file: string) => {
  const name = file.slice(file.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
  // an index/__init__ file is imported by its folder's name
  return name === 'index' || name === '__init__' ? dirOf(file).slice(dirOf(file).lastIndexOf('/') + 1) : name
}

// Files (repo-relative) whose import lines name `stem`.
async function importersOf($: EngineInterface, root: string, file: string): Promise<string[]> {
  const stem = stemOf(file).replace(/[^\w-]/g, '')
  if (!stem) return []
  const pattern = /\.py$/.test(file)
    ? // POSIX classes only: macOS git grep -E has no \s or \b
      `^[[:space:]]*(from[[:space:]]+([[:alnum:]_]+\\.)*${stem}([[:space:].]|$)|import[[:space:]]+([[:alnum:]_]+\\.)*${stem}([[:space:],]|$)|from[[:space:]]+[[:alnum:]_.]+[[:space:]]+import[[:space:]]+(.*[[:space:],])?${stem}([[:space:],]|$))`
    : `(import|require|from).*['"]([^'"]*/)?${stem}(\\.[a-z]+)?['"]`
  const r = await run($, ['git', '-C', root, 'grep', '-l', '-E', pattern])
  return r.ok ? r.out.split('\n').filter(Boolean) : []
}

// Tests reaching `files` (absolute) through imports, repo-relative, per repository:
// files from sibling repos are each searched in their own repo.
export async function affectedTests($: EngineInterface, files: string[]): Promise<{ root: string; tests: string[] }[]> {
  const byRoot = new Map<string, string[]>()
  for (const f of files) {
    const top = await run($, ['git', '-C', f.startsWith('/') ? dirOf(f) : cwd, 'rev-parse', '--show-toplevel'])
    const root = top.ok ? top.out.trim() : cwd
    byRoot.set(root, [...(byRoot.get(root) ?? []), f])
  }
  const groups: { root: string; tests: string[] }[] = []
  for (const [root, group] of byRoot) groups.push({ root, tests: await testsIn($, root, group) })
  return groups
}

// Every test path, absolute, for matching against what a command names.
export const allTests = (groups: { root: string; tests: string[] }[]) => groups.flatMap(g => g.tests.map(t => `${g.root}/${t}`))

async function testsIn($: EngineInterface, root: string, files: string[]): Promise<string[]> {
  const tests = new Set<string>()
  const seen = new Set<string>()
  let frontier = files.map(f => (f.startsWith(root + '/') ? f.slice(root.length + 1) : f))
  for (let depth = 0; depth < IMPORT_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = []
    for (const f of frontier) {
      if (seen.has(f)) continue
      seen.add(f)
      if (IS_TEST.test(f)) {
        tests.add(f)
        continue
      }
      if (/\.go$/.test(f)) {
        tests.add(`${dirOf(f)}/*_test.go`) // Go tests live beside the package
        continue
      }
      next.push(...(await importersOf($, root, `${root}/${f}`)))
    }
    frontier = next
  }
  return [...tests].sort()
}

const syntaxCheck = (f: string) =>
  /\.(sh|bash)$/.test(f) ? `bash -n ${f}`
  : /\.[cm]?js$/.test(f) ? `node --check ${f}`
  : /\.py$/.test(f) ? `python -m py_compile ${f}`
  : /\.tsx?$/.test(f) ? 'tsc --noEmit'
  : `the compiler or linter on ${f}`

export async function testsText($: EngineInterface, files: string[], known?: { root: string; tests: string[] }[]): Promise<string> {
  if (files.length === 0) return 'No code files were edited in this session; pass files to check.'
  const groups = known ?? (await affectedTests($, files))
  const roots = groups.map(g => g.root).join(', ')
  if (groups.every(g => g.tests.length === 0))
    return (
      `No test imports ${files.join(', ')} (searched ${IMPORT_DEPTH} import levels under ${roots}, by file name). ` +
      'That misses tests that reach code without importing it: end-to-end and API tests, dependency injection, event handlers, dynamic routes. ' +
      `If such a suite exists, run the part of it for this area (the tests in the same folder, or the last test command that passed). Otherwise a syntax check is the proof, such as ${files.map(syntaxCheck).join('; ')}.`
    )
  const found = groups.filter(g => g.tests.length > 0)
  const lines = found.map(g => `${groups.length > 1 ? `In ${g.root}:\n` : ''}${g.tests.join('\n')}`).join('\n')
  return `Tests that reach ${files.join(', ')} (repo root ${roots}):\n${lines}\nRun only these with the project's test runner${groups.length > 1 ? ', in each repository' : ''}.`
}

// Test files a shell command names: a run of chosen tests, as opposed to the whole suite.
export const namedTests = (command: string) =>
  command.split(/\s+/).map(t => t.replace(/^['"]|['"]$/g, '').replace(/::.*$/, '')).filter(t => IS_TEST.test(t) && /\.\w+$/.test(t))

// Whether one of `named` is one of `tests` (absolute), by path suffix: commands name them relative.
export const reachesAny = (named: string[], tests: string[]) =>
  named.some(n => tests.some(t => t === n || t.endsWith(`/${n.replace(/^\.\//, '')}`)))

