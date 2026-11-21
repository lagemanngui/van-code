import { IS_TEST } from './checks.js'

// Anti-cheat: an edit that silences a failure instead of fixing it (a type escape, a lint
// suppression, a skipped test, a swallowed exit code, a removed assertion).

const MARKERS: [label: string, rx: RegExp][] = [
  ['`as any`', /\bas any\b/g],
  ['`: any`', /:\s*any\b(?!\w)/g],
  ['`@ts-ignore`', /@ts-ignore\b/g],
  ['`@ts-nocheck`', /@ts-nocheck\b/g],
  ['`@ts-expect-error`', /@ts-expect-error\b/g],
  ['a lint suppression', /\b(eslint-disable|biome-ignore|oxlint-disable)\b|\/\/\s*nolint\b|#\s*noqa\b|#\[allow\(/g],
  ['a type-check suppression', /#\s*(type|pyright):\s*ignore\b|#\s*mypy:\s*ignore/g],
  ['a skipped test', /\b(it|test|describe)\.(skip|todo)\(|\bx(it|test|describe)\(|@pytest\.mark\.(skip|xfail)\b|\bpytest\.(skip|xfail)\(|\bt\.Skip(Now|f)?\(|#\[ignore\]/g],
  ['`|| true`', /\|\|\s*(true\b|exit 0\b|:(?!\S))/g],
]
const ASSERT = /\b(expect|assert\w*)\s*\(|\bassert\s|\bt\.(Error|Errorf|Fatal|Fatalf)\(|\bself\.assert\w*\(/g

const count = (text: string, rx: RegExp) => text.match(rx)?.length ?? 0

// What an edit (old text → new text) of `file` adds of the markers, or removes of assertions.
export function findCheats(file: string, before: string, after: string): string[] {
  const found: string[] = []
  for (const [label, rx] of MARKERS) {
    const added = count(after, rx) - count(before, rx)
    if (added > 0) found.push(`${label} (+${added})`)
  }
  if (IS_TEST.test(file)) {
    const removed = count(before, ASSERT) - count(after, ASSERT)
    if (removed > 0) found.push(`${removed} assertion${removed > 1 ? 's' : ''} removed`)
  }
  return found
}

export const cheatNote = (file: string, found: string[], failure: string) =>
  `[Jean-Claude Van Code] Anti-cheat: after ${failure} this turn, this edit of ${file} has ${found.join(', ')}. ` +
  'If it silences the failure instead of fixing it, undo it and fix the cause. If it is the right fix, tell the user why in one line.'
