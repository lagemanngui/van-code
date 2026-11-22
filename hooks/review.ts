// /van-code:review: a colleague's branch or PR, triaged before anyone reads line 1.
// The same deterministic checks the mod runs on Claude's edits, over a diff; the git work is in register.tsx.

import { cheatLines, findCheats } from './cheats.js'
import { IS_TEST } from './checks.js'
import { isDebug, isIoCall, isLocalhost, isPiiLog, isUnbounded, loopAround, stripStrings } from './cleanroom.js'
import { MIGRATION, migrationRisks } from './migrations.js'
import { SCHEMA_FILE, schemaBreaks } from './schemas.js'

export type Label = 'blocker' | 'question' | 'suggestion'
export type Finding = { file: string; line?: number; label: Label; text: string }
export type Changed = { path: string; added: number; removed: number; isRename: boolean }

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|scala|sh|vue|svelte|dart|ex|exs|lua)$/
// Line by line: data, contracts, money, access, deploy.
const HIGH =
  /(^|\/)(auth|oauth|login|sessions?|permissions?|acl|rbac|billing|payments?|invoices?|checkout|charges?|wallet|crypto|secrets?|security)([/._-]|$)|\.(proto|avsc|graphql|gql|tf|tofu)$|openapi|swagger|(^|\/)CODEOWNERS$|(^|\/)(k8s|helm|charts|deploy|\.github\/workflows)\//i
// Skim: lockfiles, generated code, snapshots, docs and assets.
export const NOISE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum|uv\.lock)$|(^|\/)(__snapshots__|generated|gen|dist|vendor)\/|\.snap$|\.pb\.go$|_pb2(_grpc)?\.py$|\.min\.(js|css)$|\.(md|txt|png|jpe?g|gif|svg|ico|webp|lock)$/i

export const TIERS = ['Line by line (high risk)', 'Logic', 'Tests', 'Skim (noise)'] as const
export function tierOf(c: Changed): 0 | 1 | 2 | 3 {
  if (NOISE.test(c.path) || (c.isRename && c.added + c.removed === 0)) return 3
  if (MIGRATION.test(c.path) || SCHEMA_FILE.test(c.path) || HIGH.test(c.path)) return 0
  if (IS_TEST.test(c.path)) return 2
  return 1
}

// A catch with an empty body: `catch {}`, `catch (e) {}`, `.catch(() => {})`, `except ...: pass`.
// `.catch(() => undefined)` returns a fallback on purpose, so it is not counted.
const SWALLOW = /\bcatch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\s*\(?\s*\w*\s*\)?\s*=>\s*\{\s*\}\s*\)|\bexcept\b[^:\n]*:\s*(\n\s*)?pass\b/g
const noComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)(\/\/|#).*$/gm, '$1')
export const swallowCount = (text: string) => stripStrings(noComments(text)).match(SWALLOW)?.length ?? 0

const lineOf = (lines: string[], l: string) => {
  const i = lines.findIndex(x => x.trim() === l.trim())
  return i === -1 ? undefined : i + 1
}

// What the checks find in one file's change, `before` empty for a new file.
export function fileFindings(path: string, before: string, after: string): Finding[] {
  const out: Finding[] = []
  const at = (label: Label, text: string, line?: number) => out.push({ file: path, label, text, ...(line ? { line } : {}) })
  const rows = after.split('\n')
  const had = new Set(before.split('\n').map(l => l.trim()))
  const added = rows.map(l => l.trim()).filter(l => l && !had.has(l))
  const isTest = IS_TEST.test(path)

  if (CODE.test(path)) {
    const marks = cheatLines(before, after)
    for (const c of findCheats(path, before, after)) {
      const isBlocker = c.startsWith('a skipped test') || c.includes('assertion')
      at(isBlocker ? 'blocker' : 'question', `adds ${c}: is it silencing a failure instead of fixing it?`, c.includes('assertion') || !marks[0] ? undefined : lineOf(rows, marks[0]))
    }
    const swallowed = swallowCount(after) - swallowCount(before)
    if (swallowed > 0) at('question', `${swallowed} new catch${swallowed > 1 ? 'es drop' : ' drops'} the error with no log or rethrow: a failure here goes silent in production`)
    if (!isTest) {
      for (const l of added.filter(isPiiLog)) at('blocker', `logs raw request data or a secret \`${l.slice(0, 80)}\`: it lands in the log store, readable by everyone with access. Log the fields needed, masked`, lineOf(rows, l))
      if (/\.([cm]?[jt]sx?|py)$/.test(path))
        for (const l of added.filter(isIoCall)) {
          const i = rows.findIndex(r => r.trim() === l)
          const loop = i === -1 ? undefined : loopAround(rows, i)
          if (loop !== undefined) at('question', `\`${l.slice(0, 70)}\` runs once per item of the loop at L${loop + 1}: 10,000 items is 10,000 round trips`, i + 1)
        }
      for (const l of added.filter(isUnbounded)) at('question', `\`${l.slice(0, 70)}\` starts every item at once: 20,000 items is 20,000 calls in flight`, lineOf(rows, l))
      for (const l of added.filter(isDebug)) at('suggestion', `debug leftover \`${l.slice(0, 80)}\``, lineOf(rows, l))
      for (const l of added.filter(isLocalhost)) at('suggestion', `hardcoded local URL \`${l.slice(0, 80)}\`: works on the author's machine only`, lineOf(rows, l))
    }
  }
  if (MIGRATION.test(path)) for (const r of migrationRisks(added, after)) at('blocker', r)
  if (SCHEMA_FILE.test(path) && before) for (const b of schemaBreaks(path, before, after)) at('blocker', `${b} (producers and consumers deploy at different times)`)
  return out
}

// Whether a changed test's text imports `path` by its file name: a new test for a new file, not yet in the working tree.
// shortcut: a name match, not import resolution; two files with the same name both count as tested.
export function isImportedBy(path: string, testText: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
  const stem = name === 'index' || name === '__init__' ? path.split('/').at(-2) ?? name : name
  return new RegExp(`(import|require|from)[^\\n]*['"/.]${stem.replace(/[^\w-]/g, '')}(\\.[a-z]+)?['"\\s]`).test(testText)
}

export function reviewText(o: { title: string; files: Changed[]; findings: Finding[]; skipped: number }): string {
  const order: Label[] = ['blocker', 'question', 'suggestion']
  const drafts = [...o.findings].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
  const count = (l: Label) => {
    const n = drafts.filter(d => d.label === l).length
    return `${n} ${l}${n === 1 ? '' : 's'}`
  }
  const per = (p: string) => drafts.filter(d => d.file === p).length
  const plus = o.files.reduce((n, f) => n + f.added, 0)
  const minus = o.files.reduce((n, f) => n + f.removed, 0)
  const width = Math.min(60, Math.max(...o.files.map(f => f.path.length), 10))
  const tiers = TIERS.map((name, t) => {
    // a file with a blocker is read line by line, wherever it sits
    const fs = o.files.filter(f => (drafts.some(d => d.file === f.path && d.label === 'blocker') ? 0 : tierOf(f)) === t)
    if (fs.length === 0) return ''
    fs.sort((a, b) => per(b.path) - per(a.path) || b.added + b.removed - (a.added + a.removed))
    const rows = fs.map(f => {
      const n = per(f.path)
      return `   ${f.path.padEnd(width)} +${f.added} −${f.removed}${n ? `   ${n} finding${n > 1 ? 's' : ''}` : ''}`
    })
    return [`${t + 1} · ${name}`, ...rows].join('\n')
  }).filter(Boolean)
  return [
    `Van Code review · ${o.title} · ${o.files.length} file${o.files.length === 1 ? '' : 's'}, +${plus} −${minus}`,
    drafts.length ? `${count('blocker')} · ${count('question')} · ${count('suggestion')}` : 'No findings from the checks. Not a clean bill: the checks see patterns, not intent, so read the top of the order anyway.',
    '',
    'Read in this order',
    ...tiers,
    ...(drafts.length
      ? ['', 'Comment drafts (keep the ones that hold up)', ...drafts.map((d, i) => `${i + 1}. [${d.label}] ${d.file}${d.line ? `:L${d.line}` : ''}: ${d.text}`)]
      : []),
    '',
    `Deterministic checks only, no model read this${o.skipped ? `; ${o.skipped} big or binary files not checked` : ''}. To have Claude check the blockers: add --claude.`,
  ].join('\n')
}

// A PR on GitHub named in full: its URL or `org/repo#123`. A bare `#123` is the current repo's.
export function parseRemotePr(target: string): { slug: string; n: string } | undefined {
  const m = target.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)|^([\w.-]+\/[\w.-]+)#(\d+)$/)
  return m ? { slug: (m[1] ?? m[3])!, n: (m[2] ?? m[4])! } : undefined
}

// `org/repo` of a GitHub remote URL (https or ssh), lowercased, or undefined for another host.
export const slugOf = (url: string) => url.trim().replace(/\.git$/, '').match(/github\.com[:/]([^/]+\/[^/]+)$/)?.[1]?.toLowerCase()

// The message that starts Claude's check of the review above it; `where` is the cached clone, when the code is not here.
export const reviewAsk = (where?: string) =>
  'Check each [blocker] and [question] of the /van-code:review above against the code; where it claims a scenario, prove it with a small test in a temporary git worktree. One line each: holds (with the evidence) or false alarm (why). Post nothing to the PR.' +
  (where ? ` The code is in the bare clone ${where}: \`git -C ${where} show <commit>:<path>\`, \`git -C ${where} worktree add <dir> <commit>\`.` : '')
