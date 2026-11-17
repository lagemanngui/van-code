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
    const r = await exec([`${root}/node_modules/.bin/tsc`, '--noEmit', '--pretty', 'false', '-p', root], root)
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
    return r && { tool: 'bash -n', isClean: r.code === 0, errors: r.code === 0 ? undefined : r.out.slice(0, 2000) }
  }
  return undefined // shortcut: Rust and others unchecked; cargo check is too slow per edit.
}

// Test selector: which tests reach a changed file through imports, found by git grep.
const IS_TEST = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/
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

// Tests reaching `files` (absolute) through imports, repo-relative.
async function affectedTests($: EngineInterface, files: string[]): Promise<{ root: string; tests: string[] }> {
  const top = await run($, ['git', '-C', cwd, 'rev-parse', '--show-toplevel'])
  const root = top.ok ? top.out.trim() : cwd
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
  return { root, tests: [...tests].sort() }
}

export async function testsText($: EngineInterface, files: string[]): Promise<string> {
  if (files.length === 0) return 'No code files were edited in this session; pass files to check.'
  const { root, tests } = await affectedTests($, files)
  if (tests.length === 0) return `No tests import ${files.join(', ')} (searched ${IMPORT_DEPTH} import levels under ${root}).`
  return `Tests that reach ${files.join(', ')} (repo root ${root}):\n${tests.join('\n')}\nRun only these with the project's test runner.`
}

