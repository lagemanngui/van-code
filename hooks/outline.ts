// Outline-first read: a big code file's declarations with their line ranges, so Claude reads only the part it needs.

// shortcut: line regexes, not a parser; a declaration split over lines or an odd style is missed. Upgrade to ast-grep if misses matter.
const DECL: RegExp[] = [
  // TS/JS: functions, classes, types, arrow-function consts, class methods
  /^\s*(export\s+)?(default\s+)?(declare\s+)?(async\s+)?function\*?\s+[\w$]+/,
  /^\s*(export\s+)?(default\s+)?(abstract\s+)?class\s+[\w$]+/,
  /^\s*(export\s+)?(declare\s+)?(interface|type|enum|namespace)\s+[\w$]+/,
  /^\s*(export\s+)?const\s+[\w$]+\s*(:[^=]+)?=\s*(async\s*)?(\([^)]*\)|[\w$]+)\s*(:[^=]+)?=>/,
  /^\s+(public\s+|private\s+|protected\s+|static\s+|readonly\s+|override\s+|async\s+|get\s+|set\s+)*[\w$]+\s*(<[^>]*>)?\([^)]*\)\s*(:\s*[^={;]+)?\{\s*$/,
  // Python, Ruby
  /^\s*(async\s+)?def\s+\w+/,
  /^\s*(class|module)\s+\w+/,
  // Go, Rust, Swift, Kotlin, PHP, Lua, Elixir, Dart-style keywords
  /^func\s/,
  /^type\s+\w+\s+(struct|interface)\b/,
  /^\s*(pub(\([\w:]+\))?\s+)?(async\s+)?(unsafe\s+)?(fn|struct|enum|trait|impl|mod)\b/,
  /^\s*((public|private|protected|internal|open|static|final|abstract|override|fileprivate)\s+)*(func|fun|function|struct|protocol|extension|object|defmodule|defp?)\s+\w+/,
  // Java, C#, C++: a typed method or class header ending in `{`
  /^\s*((public|private|protected|internal|static|final|abstract|virtual|override|sealed|partial|async)\s+)+[\w<>[\],\s]+\s+\w+\s*\([^)]*\)\s*(throws\s+[\w,\s]+)?\{?\s*$/,
]
const NOT_CODE = /^\s*(\/\/|#(?!\[)|\*|\/\*|--)/
const CONTROL = /^\s*(if|for|while|switch|catch|return|else|do|with|try|await|new)\b/
const ENTRY_MAX = 150
const TEXT_MAX = 120

// Each declaration as `L<start>-<end>  <header>`; a range runs up to the next declaration at the same or a shallower indent.
export function outline(text: string): string[] {
  const lines = text.split('\n')
  const found: { line: number; indent: number; head: string }[] = []
  lines.forEach((l, i) => {
    if (NOT_CODE.test(l) || CONTROL.test(l) || !DECL.some(rx => rx.test(l))) return
    const head = l.trim().replace(/\s*\{\s*$/, '')
    found.push({ line: i + 1, indent: l.length - l.trimStart().length, head: head.length > TEXT_MAX ? `${head.slice(0, TEXT_MAX)}…` : head })
  })
  return found.slice(0, ENTRY_MAX).map((d, i) => {
    const next = found.slice(i + 1).find(n => n.indent <= d.indent)
    const end = next ? next.line - 1 : lines.length
    return `L${d.line}-${end}  ${d.head}`
  })
}
