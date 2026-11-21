import type { EngineInterface, ModelUsage, PluginOptions, Register, SessionMessage, ToolResultSummary } from 'claude-code'

import { affectedTests, allTests, checkFile, namedTests, reachesAny, testsText } from './checks.js'
import { cardKind, cardNote } from './card.js'
import { cheatNote, findCheats } from './cheats.js'
import { outline } from './outline.js'
import { archaeologyNote, fixesRemoved, parseBlame, removedLines } from './archaeology.js'
import { addedDeps, depNote, installedDeps, INTENT_SYSTEM, intentFindings, isNamed, MANIFEST } from './intent.js'
import { findAttribution } from './attribution.js'
import { checkReceipts, claimedHashes, hashesIn } from './receipts.js'
import { judgeInfra, staleFamilies } from './infra.js'
import { judgeGit } from './git.js'
import { type Attempt, commandKey, errorLine, loopNote, nextStreak } from './loops.js'
import { cacheKey, changedRoots, isStale, manifestHashes, type ScanCache, type ScanItem, stackScan } from './stack.js'
import { isCovered, parseShellRead, type Range, readRange, resolvePath } from './reads.js'
import { checkAll, cwd, findRoots, hasWeb, infra, install, isLacking, langs, RECS, roots, run, setCwd, status } from './factory.js'
import { type Cell, cells, LAST, MAX_W, MIN_W, pixels } from './intro.js'
import {
  animateUsage,
  bar,
  cache,
  cacheLeft,
  left,
  NAMES,
  prettyModel,
  refreshUsage,
  setCache,
  setWorking,
  shown,
  snap,
  SPIN,
  usageColor,
  ttlOf,
  usageFrame,
} from './usage.js'

// Module state: a reload starts over, which just replays the intro.
let f = 0
let isDone = true
let timer: { cancel: () => void } | undefined
let isListShown = false // the checklist stays after the intro while something is missing
let isInstalling = false

function play($: EngineInterface) {
  timer?.cancel()
  f = 0
  isDone = false
  isListShown = true
  timer = $.clock.every(100, () => {
    f += 1
    if (f > LAST) {
      isDone = true
      timer?.cancel()
      if (!isLacking() && RECS.every(r => status[r.id] !== 'checking')) isListShown = false
    }
    $.ui.invalidate('ui.render')
  })
}

// Feature switches from the plugin's settings (userConfig); every one defaults on.
let options: PluginOptions = {}
const isOn = (feature: string) => options[feature] !== false

// The session's scoreboard for /van-code-stats. Token figures are estimates (bytes / 4).
const stats = {
  readsSkipped: 0,
  readTokens: 0,
  heavyBlocked: 0,
  pdfsToOcr: 0,
  jsonToJq: 0,
  loopsCaught: 0,
  receiptsFlagged: 0,
  heavyTokens: 0,
  checkCatches: 0,
  chongRuns: 0,
  chongFindings: 0,
  suggestShown: 0,
  suggestTaken: 0,
  haikuIn: 0,
  haikuOut: 0,
  infraBlocked: 0,
  gitBlocked: 0,
  restores: 0,
  proofGaps: 0,
  trimmedTokens: 0,
  stuckChecks: 0,
  uiSuggested: 0,
  cards: 0,
  guardOffs: 0,
  cheatsFlagged: 0,
  outlined: 0,
  depsUnasked: 0,
  archaeology: 0,
  intentRuns: 0,
  intentFound: 0,
  outlineTokens: 0,
  insisted: { read: 0, json: 0, pdf: 0, outline: 0, infra: 0, git: 0 },
}

// Infra guard: live-infra changes wait for a preview (plan, diff, dry run) of their family.
const previewed = new Set<string>()

// Compaction restore: the person's own words and the ledger, put back after a compaction,
// since summaries silently drop constraints and the reasons behind decisions.
const ASKS_MAX = 4_000 // chars of the person's messages kept, newest first
let asks: string[] = []
let restore: string | undefined
const KEEP_INSTRUCTIONS =
  'Keep, word for word, every constraint, prohibition and acceptance criterion the user stated, every repository, service and environment the task involves, and the reason behind each decision taken so far.'

// Compaction trim: old bulky tool output is cut before the summarizer reads it. Masking old
// observations matches summarizing them at a fraction of the cost (The Complexity Trap, 2025).
const TRIM_KEEP = 12 // newest messages left whole: the summary leans on them, and core may keep them
const TRIM_OVER = 2_000 // chars: a tool output longer than this is cut
const TRIM_HEAD = 600 // chars of it kept
export function trimOld(messages: readonly SessionMessage[]): { messages: SessionMessage[]; cut: number } {
  let cut = 0
  const isBulky = (r: ToolResultSummary) => !r.isError && r.text.length > TRIM_OVER // errors stay whole: they explain decisions
  const out = messages.map((m, i) => {
    if (i >= messages.length - TRIM_KEEP || m.role !== 'user' || !m.toolResults?.some(isBulky)) return m
    const toolResults = m.toolResults.map(r => {
      if (!isBulky(r)) return r
      cut += r.text.length - TRIM_HEAD
      return { tool_use_id: r.tool_use_id, isError: r.isError, text: `${r.text.slice(0, TRIM_HEAD)}\n[... ${r.text.length - TRIM_HEAD} chars of old tool output cut before compaction]` }
    })
    // without its handle the engine builds the message from these fields, not its own copy
    const { handle: _handle, ...rest } = m
    return { ...rest, toolResults }
  })
  return { messages: out, cut }
}

function restoreText() {
  const kept: string[] = []
  let size = 0
  for (const a of [...asks].reverse()) {
    if (size + a.length > ASKS_MAX) break
    kept.unshift(a)
    size += a.length
  }
  const parts = [
    kept.length > 0 &&
      `The user's own messages in this session, verbatim${kept.length < asks.length ? ' (oldest left out)' : ''}:\n${kept.map(a => `> ${a.replace(/\n/g, '\n> ')}`).join('\n\n')}`,
    !isLedgerEmpty() && `Assumption ledger:\n${ledgerText()}`,
  ].filter(Boolean)
  if (parts.length === 0) return undefined
  return `[Jean-Claude Van Code] The conversation was just compacted. Re-read what follows; it outranks the summary where they differ.\n\n${parts.join('\n\n')}`
}
let lastSuggested = ''
let usageMinute: { cancel: () => void } | undefined
const countUsage = (u?: ModelUsage) => {
  stats.haikuIn += (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0)
  stats.haikuOut += u?.output_tokens ?? 0
}
const onOff = (b: boolean) => (b ? 'on' : 'off')
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

function statsText() {
  return [
    'Jean-Claude Van Code · session scoreboard (token figures are estimates)',
    `Repeat reads skipped: ${stats.readsSkipped} (~${k(stats.readTokens)} tokens) · read memory ${onOff(isOn('readMemory'))}`,
    `Heavy files blocked: ${stats.heavyBlocked} (~${k(stats.heavyTokens)} tokens) · guard ${onOff(isGuardOn)} · turned off ${stats.guardOffs}x`,
    `Blocks Claude insisted past (likely false blocks): ${Object.entries(stats.insisted).map(([g, n]) => `${g} ${n}`).join(' · ')}`,
    `PDFs pointed to Indra OCR: ${stats.pdfsToOcr} · ${status.indra === 'ok' ? 'indra installed' : 'indra not installed'}`,
    `Big code files shown as an outline first: ${stats.outlined} (~${k(stats.outlineTokens)} tokens) · outline first ${onOff(isOn('outlineFirst'))}`,
    `Intent diff: ${stats.depsUnasked} unnamed dependencies flagged, ${stats.intentFound} of ${stats.intentRuns} big turns off the request · intent diff ${onOff(isOn('intentDiff'))}`,
    `Removed lines that came from fixes, flagged: ${stats.archaeology} · archaeology ${onOff(isOn('archaeology'))}`,
    `Big JSON pointed to jq: ${stats.jsonToJq} · ${status.jq === 'ok' ? 'jq installed' : 'jq not installed'}`,
    `Loops caught (${LOOP_FAILS} related commands failing in a row): ${stats.loopsCaught}`,
    `Answer claims the tool output contradicted (receipts): ${stats.receiptsFlagged} · receipts ${onOff(isOn('receipts'))}`,
    `Infra changes held for a preview: ${stats.infraBlocked} · infra guard ${onOff(isOn('infraGuard'))}`,
    `Git commands held over uncommitted work or a force push: ${stats.gitBlocked} · git guard ${onOff(isOn('gitGuard'))}`,
    `Test runs that missed the edited code: ${stats.proofGaps} · prove it ${onOff(isOn('proveIt'))}`,
    `Edits that silenced a failure (type escape, skipped test, removed assertion): ${stats.cheatsFlagged} · anti-cheat ${onOff(isOn('antiCheat'))}`,
    `Cards read as a story, bug or task and planned first: ${stats.cards} · card plan ${onOff(isOn('cardPlan'))}`,
    `UI changes Claude was asked to check in a browser: ${stats.uiSuggested} · ${status.playwright === 'ok' ? 'playwright-cli installed' : status.playwright === 'none' ? 'no web frontend here' : 'playwright-cli not installed'}`,
    `Old tool output cut before compactions: ~${k(stats.trimmedTokens)} tokens the summarizer did not read · compaction trim ${onOff(isOn('compactTrim'))}`,
    `Restored after a compaction: ${stats.restores} · compaction restore ${onOff(isOn('compactRestore'))}`,
    lastTask ? `Last request: ${lastTask}` : 'Last request: none finished yet',
    `Session: ${tokensLine(tokens)}`,
    requestsDone > 0
      ? `Average per request: ~US$ ${(costDone / requestsDone).toFixed(2)} over ${requestsDone} (cost includes the mod's Haiku calls)`
      : 'Average per request: no cost figure yet',
    `Errors caught right after an edit: ${stats.checkCatches} (type or syntax errors the post-edit check found in an edited file · post-edit check ${onOff(isOn('postEditCheck'))}); stuck on the same error ${STUCK_EDITS}+ edits in a row: ${stats.stuckChecks}`,
    `Chong Li: ${stats.chongRuns} reviews, ${stats.chongFindings} findings`,
    `Mod suggestions: ${stats.suggestShown} shown, ${stats.suggestTaken} taken`,
    `Haiku calls: ${k(stats.haikuIn)} input tokens, ${k(stats.haikuOut)} output tokens`,
  ].join('\n')
}

// Heavy files: lockfiles, dependencies, build output, minified bundles.
const HEAVY =
  /(^|\/)(node_modules|dist|\.next|coverage|vendor|\.git|__pycache__)\/|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock)$|\.min\.(js|css)$|\.map$/
const SLICE_MAX = 300
// Logs and data dumps: heavy only when big, a short migration or CSV fixture reads fine whole.
const BULKY = /\.(log|csv|tsv|sql|jsonl|ndjson)$/i
const BULKY_MIN = 100_000 // bytes, ~25k tokens
// The file's size when reading it whole is wasteful, else undefined.
async function heavySize($: EngineInterface, file: string): Promise<number | undefined> {
  if (!HEAVY.test(file) && !BULKY.test(file)) return undefined
  const size = (await $.fs.stat(file).catch(() => undefined))?.size
  if (HEAVY.test(file)) return size ?? 0
  return size !== undefined && size >= BULKY_MIN ? size : undefined
}
const HEAVY_WHAT = '(lockfile, dependency, build output, minified, or a big log or data dump)'
const BULKY_HINT = ' For a log: `wc -l`, `tail -n`, grep the error. For CSV/SQL: the header with `head -n 5`, or query it (duckdb, sqlite3).'
let isGuardOn = true

// "Prove it works": code edited in a turn with no test/build/type-check after.
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|scala|sh|vue|svelte|gd|lua|ex|exs|dart)$/
const VERIFY =
  /\b(test|tests|pytest|jest|vitest|mocha|tsc|build|lint|eslint|check|validate|cargo|go (test|build|vet)|make|gradle|mvn|swift (build|test)|xcodebuild|ruff|mypy|rspec|shellcheck|py_compile|playwright)\b|\b(ba|z|da)?sh -n\b/
// Commands that only read or record: `cat a.test.ts` or `git commit -m "tests"` verify nothing.
const READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'bat', 'sed', 'awk', 'grep', 'rg', 'ag', 'ls', 'find', 'fd', 'wc', 'diff', 'echo', 'printf', 'git', 'jq', 'open', 'code', 'vim', 'nano'])
// The parts of a shell command that run a test, build or check.
export function verifySegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map(s => s.trim().replace(/^(rtk( bypass)?|time|(\w+=\S+\s+)+)\s*/, '').trim())
    .filter(s => !READERS.has(s.split(/\s+/)[0] ?? '') && VERIFY.test(s))
}
// Infra files get the post-edit check too, but are not code for "prove it".
const INFRA_FILE = /\.(tf|tofu|ya?ml)$/
let hasUnverifiedEdit = false
// Anti-cheat: the failure seen this turn (a check or a test run), so a later edit that silences it is caught.
let turnFailure = ''
// Notes the model reads with the person's next message.
let notes: string[] = []
const NOTE =
  '[Jean-Claude Van Code] In the previous turn you edited code but ran no test, build or type-check afterwards. Verify that change before building on it, and say what you ran.'

// Assumption ledger: what a plan rests on, each checked before code is written.
type Assumption = { id: number; text: string; state: 'open' | 'true' | 'false'; evidence?: string }
// Targets: every repo, service or contract the change must reach. Stopping once one repo
// is green is the main way multi-repo work ends incomplete.
type Target = { id: number; text: string; state: 'open' | 'done' | 'na'; note?: string }
type LedgerInput = {
  reset?: boolean
  add?: string[]
  verify?: { id: number; holds: boolean; evidence: string }[]
  targets?: string[]
  mark?: { id: number; state: 'done' | 'na'; note: string }[]
}
let ledger: Assumption[] = []
let targets: Target[] = []
const isPathTarget = (t: Target) => t.text.startsWith('/')
const isLedgerOpen = () => ledger.some(a => a.state === 'open') || targets.some(t => t.state === 'open')
const isLedgerEmpty = () => ledger.length === 0 && targets.length === 0
let isLedgerShown = false // shown from its first entry until a new message finds nothing open
const LEDGER_TOOL_RX = /^mcp__van-code__assumptions$/
const DONE_CLAIM = /\b(pronto|funciona|feito|conclu[ií]d[oa]|resolvid[oa]|corrigid[oa]|done|works|fixed|complete[d]?)\b/i
const LEDGER_DESC = `Assumption ledger. For a non-trivial task (several files, an unfamiliar API or library, a design choice), call it BEFORE writing code:
1. reset: true, then add: every assumption the plan rests on, one fact each ("fs.stat rejects on a missing path", "only X calls Y").
2. Check each with the cheapest proof (read the types or docs, grep, run one line) and record verify: { id, holds, evidence } with the evidence in a few words.
3. An assumption that does not hold means re-plan before coding.
4. When the change spans several repositories, services or contracts (API, schema, event, config), list each in targets, a repository as its absolute path. Mark each done (with what changed) or na (with why) before saying the work is done; an edit inside a path target marks it done by itself.
Do not claim the work is done while any assumption or target is still open; name the open ones instead. Returns the ledger.`

function ledgerText() {
  if (isLedgerEmpty()) return 'Ledger is empty.'
  const lines = ledger.map(
    a => `#${a.id} [${a.state === 'open' ? 'OPEN' : a.state === 'true' ? 'HOLDS' : 'FALSE'}] ${a.text}${a.evidence ? ` (evidence: ${a.evidence})` : ''}`,
  )
  if (targets.length > 0) {
    lines.push('Targets:')
    lines.push(...targets.map(t => `T${t.id} [${t.state === 'open' ? 'OPEN' : t.state === 'done' ? 'DONE' : 'N/A'}] ${t.text}${t.note ? ` (${t.note})` : ''}`))
  }
  return lines.join('\n')
}

function applyLedger(input: LedgerInput) {
  if (input.reset) {
    ledger = []
    targets = []
  }
  for (const text of input.add ?? []) ledger.push({ id: ledger.length + 1, text, state: 'open' })
  for (const v of input.verify ?? []) {
    const a = ledger.find(x => x.id === v.id)
    if (a) Object.assign(a, { state: v.holds ? 'true' : 'false', evidence: v.evidence })
  }
  for (const text of input.targets ?? []) targets.push({ id: targets.length + 1, text: text.replace(/\/+$/, ''), state: 'open' })
  for (const m of input.mark ?? []) {
    const t = targets.find(x => x.id === m.id)
    if (t) Object.assign(t, { state: m.state, note: m.note })
  }
}

// An edit inside a path target reaches it.
function touchTargets(file: string) {
  let isChanged = false
  for (const t of targets)
    if (t.state === 'open' && isPathTarget(t) && file.startsWith(`${t.text}/`)) {
      Object.assign(t, { state: 'done', note: `edited ${file.slice(t.text.length + 1)}` })
      isChanged = true
    }
  return isChanged
}

// Receipts: the main thread's tool output this turn, and every hex run any tool printed this session.
const TURN_OUTPUT_MAX = 200_000
let turnOutput = ''
const seenHashes = new Set<string>()

// Post-edit check, per batch: the edits one response asks for land together, and the check runs once
// the last of them has, on every file the batch touched. Checking after each edit reported errors the
// next edit of the same response was about to fix.
type EditBatch = { pending: number; files: Set<string> }
const editBatches = new Map<string, EditBatch>() // by agent
const isCheckedEdit = (tool: string, file: string) => (tool === 'Edit' || tool === 'Write') && (CODE_FILE.test(file) || INFRA_FILE.test(file))

// One file's check: updates the proof and stuck-error state, returns the note for Claude, if any.
async function checkEdited($: EngineInterface, file: string): Promise<string | undefined> {
  const found = await checkFile($, file)
  // a clean type-check is a verification; a syntax-only pass is not
  if (found?.isClean && (found.tool === 'tsc' || found.tool === 'go vet')) hasUnverifiedEdit = false
  // with no test to run, a clean syntax check is all the proof there is (judged at turn end)
  if (found?.isClean) syntaxClean.add(file)
  else syntaxClean.delete(file)
  if (!found?.errors) {
    checkFails.delete(file)
    return undefined
  }
  stats.checkCatches += 1
  turnFailure ||= `${found.tool} errors in ${file}`
  // the same errors after another edit: a structural one, which retrying rarely fixes
  const sig = errorSig(found.errors)
  const before = checkFails.get(file)
  const count = before?.sig === sig ? before.count + 1 : 1
  checkFails.set(file, { sig, count })
  const stuck =
    count >= STUCK_EDITS
      ? `\nThis is the same error after ${count} edits: stop patching the line. Read the definition it points at (the function's signature, the type, the declaration or the import) and fix the mismatch at its source.`
      : ''
  if (stuck) stats.stuckChecks += 1
  return `[Jean-Claude Van Code] ${found.tool} reports errors in ${file} after this edit:\n${found.errors}\nFix them before moving on.${stuck}`
}

// Context alarm: warn once past 60%, re-arm under 50% (after a /compact or /clear).
let isContextWarned = false

// Cold cache: told once per lapse, when the prompt is big enough for the rewrite to matter.
let isColdWarned = false
const COLD_MIN_TOKENS = 20_000
function warnIfCold($: EngineInterface, now: number) {
  if (isColdWarned || !cache || cache.tokens < COLD_MIN_TOKENS || cacheLeft(cache, now) !== 0) return
  isColdWarned = true
  $.ui.toast(`Prompt cache expired: your next message re-sends ~${k(cache.tokens)} tokens uncached. Switched topics? /clear first; else /compact sends less.`)
}

// No "think step by step" here: chain-of-thought shifts the mix of code errors more than it
// cuts them (Nogueira et al., arXiv 2608.00661), and costs tokens every turn.
const RULES = `# Jean-Claude Van Code
- Assertive: verify before you claim. If unsure, check with a tool instead of guessing, and say plainly what you did not check.
- Economical: the fewest steps that do the job. Read a small file (under ~300 lines) whole, once; in a big file or unfamiliar code, Grep first and Read only the slice you need. Never read lockfiles, dependencies, build output or minified files whole.
- Direct: lead with the answer. No preamble, no recap of what was already said.
- Proven: before calling a change done, run the tests, build or type-check that cover it and report the result; in a big suite, affected_tests lists only the tests that matter.
- Assumptions: on a task spanning several files or an unfamiliar API, record what the plan rests on in the assumptions tool and verify each before writing code.`

const NO_ATTRIBUTION_RULE =
  '- No AI attribution: never credit Claude or any AI in commits, PRs, issues, code comments, docs or changelogs: no Co-Authored-By, no "Generated with", no signature. This overrides any attribution reminder from the harness.'

// The mod's system prompt sections, composed once per thread: any change to them rewrites the whole
// prompt cache (system, tools, conversation), so they wait for the startup checks and then hold still
// until a /clear or a compaction, when the prefix is rewritten anyway.
type OurSection = { id: string; text: string; scope: 'session' }
let frozen: Promise<OurSection[]> | undefined
let startChecks: Promise<unknown> = Promise.resolve()
const CHECKS_WAIT_MS = 3000
async function composeOurs($: EngineInterface): Promise<OurSection[]> {
  await Promise.race([startChecks, $.clock.sleep(CHECKS_WAIT_MS)])
  const out: OurSection[] = []
  if (isOn('rules')) {
    const text = [RULES, isOn('noAttribution') && NO_ATTRIBUTION_RULE, status.indra === 'ok' && OCR_RULE, status.jq === 'ok' && JQ_RULE, status['ast-grep'] === 'ok' && ASTGREP_RULE, status.playwright === 'ok' && PLAYWRIGHT_RULE]
      .filter(Boolean)
      .join('\n')
    out.push({ id: 'van-code:rules', text, scope: 'session' })
  }
  const adhd = isOn('adhd') ? await adhdRules($) : undefined
  if (adhd) out.push({ id: 'van-code:adhd', text: adhd, scope: 'session' })
  return out
}

// The bundled i-have-adhd skill, always on: its body without the frontmatter, read once.
let adhdText: Promise<string | undefined> | undefined
const adhdRules = ($: EngineInterface) =>
  (adhdText ??= $.fs
    .read(`${$.plugin.root}/skills/i-have-adhd/SKILL.md`)
    .then(s => `ADHD MODE ACTIVE (always-on).\n${s.replace(/^---\n[\s\S]*?\n---\n/, '')}`)
    .catch(() => undefined))

const OCR_RULE =
  '- Documents: to read a PDF or scan as text, run `indra-ocr <file> --out <dir>` (local, free) and Grep or Read the .md it writes; Read the PDF itself only for figures, charts or layout, or a few pages (`pages`).'

// PDFs: more than this many pages as images costs more than Indra's text.
const OCR_MIN_PAGES = 4
const pdfPages = (pages?: string) => {
  if (!pages) return Infinity
  const [a, b] = pdfRange(pages)
  return b - a + 1
}
const pdfRange = (pages: string): Range => {
  const [a, b = a] = pages.split('-').map(Number)
  return [a!, b!]
}
const onceWarned = new Set<string>() // PDF and JSON redirects: once per agent and file; insisting goes through
// A refused call that went through when asked again: counted once per refusal, for /van-code-stats.
const insistedKeys = new Set<string>()
function insisted(guard: keyof typeof stats.insisted, key: string) {
  if (insistedKeys.has(key)) return
  insistedKeys.add(key)
  stats.insisted[guard] += 1
}

// Big code file: its outline first, so Claude reads only the function it needs. Once per agent and file.
const OUTLINE_MIN_LINES = 400
async function outlineDeny($: EngineInterface, agentId: string | undefined, file: string) {
  if (!isOn('outlineFirst') || !CODE_FILE.test(file)) return undefined
  const key = readKey(agentId, file)
  if (reads.has(key)) return undefined // already read in part: it knows the file
  if (onceWarned.has(`outline|${key}`)) return void insisted('outline', `outline|${key}`)
  const text = await $.fs.read(file).catch(() => undefined)
  if (typeof text !== 'string') return undefined
  const lines = text.split('\n').length
  if (lines < OUTLINE_MIN_LINES) return undefined
  const entries = outline(text)
  if (entries.length < 3) return undefined // too few declarations to steer by
  onceWarned.add(`outline|${key}`)
  const shown = entries.join('\n')
  stats.outlined += 1
  stats.outlineTokens += Math.round((text.length - shown.length) / 4)
  return (
    `Jean-Claude Van Code: ${file} is ${lines} lines. Its outline (a range runs to the next declaration, so it may include code between them):\n${shown}\n` +
    'Read only what you need with offset/limit, or Grep for a name. If you truly need the whole file, call Read again with the same arguments and it will go through.'
  )
}

// Big JSON: sliced with jq rather than read whole.
const JSON_MAX = 32_000 // bytes
const JQ_RULE = '- JSON: slice a big JSON file with jq (`jq keys`, `jq \'.path\'`) instead of reading it whole.'
async function jsonDeny($: EngineInterface, agentId: string | undefined, file: string) {
  if (status.jq !== 'ok' || !/\.json$/i.test(file)) return undefined
  const key = readKey(agentId, file)
  if (onceWarned.has(key)) return void insisted('json', key)
  const st = await $.fs.stat(file).catch(() => undefined)
  if (!st || st.size <= JSON_MAX) return undefined
  onceWarned.add(key)
  stats.jsonToJq += 1
  return (
    `Jean-Claude Van Code: ${file} is ${Math.round(st.size / 1000)} KB of JSON. Slice it with jq: \`jq keys\` for its shape, then \`jq '.path.to.what.you.need'\`. ` +
    'If you truly need it whole, run the same read again and it will go through.'
  )
}

const PLAYWRIGHT_RULE =
  '- UI: verify a user-facing web change by using it as a user would, with `playwright-cli` (open the page, snapshot, click, fill, screenshot; the playwright-cli skill has the details), and say what you saw. A flow worth keeping becomes a Playwright test.'

// UI suggestion: a user-facing change no browser ever saw. Asked once per file, in a repo with a web frontend.
const UI_FILE = /\.(tsx|jsx|vue|svelte|astro|html|css|scss)$/
const BROWSER = /\bplaywright\b/
let turnUi = new Set<string>() // UI files edited this turn
let ranBrowser = false // a playwright command or tool ran this turn
const uiAsked = new Set<string>()
let isPlaywrightOffered = false

const ASTGREP_RULE =
  "- Code by structure: `ast-grep -p '<pattern>' -l <lang> [paths]` finds code by its shape (`fetch($$$)` calls, a function by signature) where a regex would be fragile; `$X` matches one node, `$$$` many."

// Stuck checker: the same checker errors on a file edit after edit, per file.
const STUCK_EDITS = 2
const checkFails = new Map<string, { sig: string; count: number }>()
// Errors without line and column numbers, which move as the file is edited.
export const errorSig = (errors: string) =>
  errors.replace(/[:(]\d+(,\d+)?\)?(:\d+)?/g, '').replace(/\bline \d+/g, 'line').trim()

// Loop detector: related shell commands failing again and again, per agent.
const LOOP_FAILS = 3
const failing = new Map<string, Attempt[]>()

// The last finished request: what it cost and how much it did.
let task = { costUsd: 0, startedAt: 0, toolCalls: 0 }
let lastTask = ''

// Where the input tokens went, per model request (subagents included): billed cost is
// mostly cache traffic, so a cut in tool output can save tokens and still cost more.
type Tokens = { requests: number; input: number; cacheRead: number; cacheWrite: number; output: number }
export const noTokens = (): Tokens => ({ requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
const tokens = noTokens()
let taskTokens = noTokens()
// Person's requests finished since the mod loaded, and their summed cost. Not the engine's session
// total: that one spans the whole session, a /reload-plugins included, and would inflate the average.
let requestsDone = 0
let costDone = 0
export function addTokens(u: ModelUsage, into: Tokens[] = [tokens, taskTokens]) {
  for (const t of into) {
    t.requests += 1
    t.input += u.input_tokens
    t.cacheRead += u.cache_read_input_tokens
    t.cacheWrite += u.cache_creation_input_tokens
    t.output += u.output_tokens
  }
}
// Share of the input the cache served.
const hitRate = (t: Tokens) => {
  const all = t.input + t.cacheRead + t.cacheWrite
  return all === 0 ? 0 : Math.round((t.cacheRead / all) * 100)
}
export const tokensLine = (t: Tokens) =>
  `${t.requests} model requests · input ${k(t.input)} uncached, ${k(t.cacheRead)} cache read, ${k(t.cacheWrite)} cache write (${hitRate(t)}% from cache) · output ${k(t.output)}`
const duration = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s` : `${Math.round(ms / 1000)}s`)

async function refreshStatus($: EngineInterface) {
  const u = await $.session.usage()
  const cost = u.cost ? `~US$ ${u.cost.usd.toFixed(2)}` : ''
  $.ui.status(['Van Code', cost].filter(Boolean).join(' · ')) // context is on the usage header
  const pct = u.context.percent ?? 0
  if (isOn('contextAlarm') && pct >= 60 && !isContextWarned) {
    isContextWarned = true
    $.ui.toast(`Context at ${Math.round(pct)}%: consider /compact (or /clear if you switched topics)`)
  } else if (pct < 50) {
    isContextWarned = false
  }
}

// Chong Li: a cheap adversarial review of code changes, on its own model call.
type Change = { file: string; text: string; lines: number }
let unreviewed: Change[] = [] // code changes since Chong Li last looked
let turnLines = 0
let isTurnRisky = false
let isReviewing = false
const BIG_CHANGE = 30 // lines in one turn worth an automatic review
const DIFF_MAX = 60_000 // characters sent to the reviewer, newest kept
const RISKY =
  /\b(delete|drop|truncate|rm -rf|unlink|migrat\w*|auth\w*|password|token|secret|crypto|payment|price|amount|balance|mutex|lock|thread|race|concurren\w*|parse\w*|JSON\.parse|sql|query|exec|eval|shell|subprocess)\b/i
const CHONG_LI_SYSTEM = `You are Chong Li, a ruthless adversarial code reviewer. You get the code changes of one task.
Find ONE concrete way these changes break: a specific input or state, and the crash, wrong result, data loss or security hole it causes.
Only real defects. No style, naming, refactors or "consider adding tests".
You see only the changes, not the rest of the code: never claim a bug that depends on code you cannot see.
Look hardest at the runtime defects compilers and retries rarely catch: an index past either end (i-1 at i=0, <= length, an empty list), integer overflow, recursion with no depth bound, and input parsing that breaks on empty, missing or oddly formatted input.
If you cannot name a concrete failing scenario, answer exactly: NONE
Otherwise answer in at most 3 short lines: the file and what breaks, then the input or state that triggers it.`

const lineCount = (t: string) => (t ? t.split('\n').length : 0)

let turnDiff: string[] = [] // this turn's changes, for the intent diff

// Archaeology: the fix commits behind the lines an edit removes, blamed before the edit lands.
const archaeologySeen = new Set<string>() // file|hash, told once
async function fixesBehind($: EngineInterface, file: string, oldString: string, newString: string) {
  const removed = removedLines(oldString, newString)
  if (removed.size === 0) return []
  const text = await $.fs.read(file).catch(() => undefined)
  const at = typeof text === 'string' ? text.indexOf(oldString) : -1
  if (at === -1) return []
  const start = text!.slice(0, at).split('\n').length
  const end = start + oldString.split('\n').length - 1
  const r = await run($, ['git', '-C', file.slice(0, file.lastIndexOf('/')) || '/', 'blame', '-L', `${start},${end}`, '--porcelain', '--', file], 10_000)
  if (!r.ok) return [] // not in a repository, or the file is new
  return fixesRemoved(parseBlame(r.out), removed).filter(f => !archaeologySeen.has(`${file}|${f.hash}`))
}
// The person's last few messages: a follow-up ("do it") leans on the ones before it.
const recentAsks = () => asks.slice(-3).join('\n\n')

function recordChange(file: string, text: string, lines: number) {
  unreviewed.push({ file, text, lines })
  turnDiff.push(text)
  turnLines += lines
  if (RISKY.test(file) || RISKY.test(text)) isTurnRisky = true
}

// Answers the finding, or undefined when Chong Li found nothing (or could not run).
async function chongLi($: EngineInterface, diff: string): Promise<string | undefined> {
  isReviewing = true
  $.ui.status('Chong Li is looking for a way to break this...')
  try {
    const r = await $.model.complete({
      model: 'haiku',
      system: CHONG_LI_SYSTEM,
      prompt: diff.slice(-DIFF_MAX),
      maxTokens: 400,
      effort: 'low',
      timeoutMs: 60_000,
    })
    stats.chongRuns += 1
    countUsage(r.usage)
    if (!r.isAnswered) return undefined
    const text = r.text.trim()
    if (/^NONE\b/.test(text)) return undefined
    stats.chongFindings += 1
    return text
  } finally {
    isReviewing = false
    void refreshStatus($)
  }
}

// Intent diff, model part: the request against a big turn's changes. Undefined when they match (or it could not run).
async function intentCheck($: EngineInterface, request: string, diff: string): Promise<string | undefined> {
  const r = await $.model.complete({
    model: 'haiku',
    system: INTENT_SYSTEM,
    prompt: `The developer's request:\n${request.slice(-4000)}\n\nThe changes:\n${diff.slice(-DIFF_MAX)}`,
    maxTokens: 300,
    effort: 'low',
    timeoutMs: 60_000,
  })
  stats.intentRuns += 1
  countUsage(r.usage)
  const found = r.isAnswered ? intentFindings(r.text) : undefined
  if (found) stats.intentFound += 1
  return found
}

function takeUnreviewed(): string {
  const diff = unreviewed.map(c => c.text).join('\n\n')
  unreviewed = []
  return diff
}

// Read memory: per agent and file, the line ranges read and the file's state then.
// A read inside those ranges of an unchanged file is refused once; asking again goes through.
type ReadEntry = { mtimeMs: number; size: number; ranges: Range[]; isWarned: boolean; anchor?: string }
const reads = new Map<string, ReadEntry>()
const readKey = (agent: string | undefined, file: string) => `${agent ?? 'main'}|${file}`

// The newest transcript row: if a compaction leaves it behind, so are the reads after it.
async function newestRow($: EngineInterface, agentId?: string): Promise<string | undefined> {
  const rows = await $.session.messages({ agentId, last: 1 }).catch(() => undefined)
  return Array.isArray(rows) ? (rows.at(-1) as { uuid?: string } | undefined)?.uuid : undefined
}
// session.compact can be skipped by a plugin above us, so the transcript is the proof.
async function isCompactedSince($: EngineInterface, agentId: string | undefined, anchor?: string) {
  if (!anchor) return false
  const rows = await $.session.messages({ agentId, after: anchor }).catch(() => undefined)
  return !Array.isArray(rows)
}

// The refusal for a repeat read, or undefined to let it run.
async function repeatDeny($: EngineInterface, agentId: string | undefined, file: string, range: Range) {
  if (!isOn('readMemory')) return undefined
  const key = readKey(agentId, file)
  const before = reads.get(key)
  if (!before || !isCovered(before.ranges, range)) return undefined
  const now = await $.fs.stat(file).catch(() => undefined)
  if (!now || now.mtimeMs !== before.mtimeMs || now.size !== before.size || (await isCompactedSince($, agentId, before.anchor))) {
    reads.delete(key)
    return undefined
  }
  if (before.isWarned) {
    stats.insisted.read += 1 // remember() re-arms it, so each refusal counts once
    return undefined
  }
  before.isWarned = true
  stats.readsSkipped += 1
  stats.readTokens += Math.round(now.size / 4)
  return (
    `Jean-Claude Van Code: you already read ${file} (these lines) in this conversation and it has not changed since. ` +
    'Use what you read. If it is truly no longer in your context, run the same read again and it will go through.'
  )
}

async function remember($: EngineInterface, agentId: string | undefined, file: string, range: Range) {
  const now = await $.fs.stat(file).catch(() => undefined)
  if (!now) return
  const key = readKey(agentId, file)
  const before = reads.get(key)
  if (before && before.mtimeMs === now.mtimeMs && before.size === now.size) {
    before.ranges.push(range)
    before.isWarned = false
    return
  }
  reads.set(key, { mtimeMs: now.mtimeMs, size: now.size, ranges: [range], isWarned: false, anchor: await newestRow($, agentId) })
}

// Test selector state; the search lives in checks.ts.
const TESTS_TOOL_RX = /^mcp__van-code__affected_tests$/
const editedFiles = new Set<string>() // code files edited this session
let turnEdited = new Set<string>()
let ranTests: string[] = [] // test files named by test commands since the last code edit
const syntaxClean = new Set<string>() // files whose last post-edit check passed

// Follow-up suggestions: when the engine shows none after a turn, propose one.
const SUGGEST_WAIT = 4_000 // the engine's own guess gets this long to show first
let lastUserText = ''
let lastSent = '' // the last prompt or slash command, to keep it from being suggested again
let isEngineSuggested = false
let suggestWait: { cancel: () => void } | undefined
const SUGGEST_SYSTEM = `You predict the next message a developer will send to their coding assistant.
Reply with ONLY that message: under 15 words, same language and tone as the developer's last message, no quotes.
If the assistant asked a question or offered options, answer it the way the developer most likely would, usually accepting the recommendation.
If the assistant reported finished work, the likely next step (test it, the next item, a fix).
Never a slash command, and never the developer's last message again.`

// One line, no wrapping quotes, short enough for the prompt box, never a slash command.
export function cleanSuggestion(text: string): string | undefined {
  const line = text.trim().split('\n')[0]!.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim()
  return line && line.length <= 200 && !line.startsWith('/') ? line : undefined
}

// Same text as the last thing sent, or the same slash command with any arguments.
export function isRepeat(text: string, last: string): boolean {
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')
  const a = norm(text)
  const b = norm(last)
  return a !== '' && (a === b || (a.startsWith('/') && a.split(' ')[0] === b.split(' ')[0]))
}

async function suggestFollowUp($: EngineInterface, answer: string) {
  if (isEngineSuggested || !answer.trim()) return
  const r = await $.model.complete({
    model: 'haiku',
    system: SUGGEST_SYSTEM,
    prompt: `Developer's last message:\n${lastUserText.slice(-1500)}\n\nAssistant's reply (its end):\n${answer.slice(-4000)}`,
    maxTokens: 60,
    effort: 'low',
    timeoutMs: 15_000,
  })
  countUsage(r.usage)
  const text = r.isAnswered ? cleanSuggestion(r.text) : undefined
  if (!text || isEngineSuggested || isRepeat(text, lastSent)) return
  if ((await $.prompt.suggest({ text })).isShown) {
    stats.suggestShown += 1
    lastSuggested = text
  }
}

// Session start, no network: only when a scanned folder's manifests changed since /van-code-scan.
async function scanNotice($: EngineInterface) {
  try {
    const scanned = await findRoots($)
    const cache = (await $.store.get(cacheKey(scanned))) as ScanCache | undefined
    if (!cache) return
    const changed = changedRoots(cache.hashes, await manifestHashes(p => $.fs.read(p), scanned))
    if (changed.length === 0) return
    const names = changed.map(r => (r === scanned[0] ? '.' : r.slice(r.lastIndexOf('/') + 1)))
    $.ui.toast(`Dependências novas em ${names.join(', ')}: rode /van-code-scan`)
  } catch {} // a notice, never a reason for the session to fail
}

export const register: Register = (on, opts) => {
  options = opts
  on('session.start', async ($, e, next) => {
    setCwd(e.cwd)
    await $.command.register({
      name: 'van-code',
      description: 'Jean-Claude Van Code: play the flying kick again',
    })
    await $.command.register({
      name: 'van-code-setup',
      description: 'Jean-Claude Van Code: install the missing factory equipment',
    })
    await $.command.register({
      name: 'van-code-guard',
      description: 'Jean-Claude Van Code: turn the heavy-file guard off or on for this session',
    })
    await $.command.register({
      name: 'van-code-stats',
      description: 'Jean-Claude Van Code: what the mod saved and spent in this session',
    })
    await $.command.register({
      name: 'van-code-scan',
      description: 'Jean-Claude Van Code: find official skills, plugins and docs for AI agents for this stack (on demand, uses the network)',
    })
    await $.command.register({
      name: 'chong-li',
      description: 'Jean-Claude Van Code: Chong Li tries to break the latest code changes',
    })
    await $.tool.register({
      name: 'affected_tests',
      description:
        'Lists the test files that reach the given source files through imports (git grep, up to 4 levels), so you run only the relevant tests. Defaults to the code files edited in this session.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: { files: { type: 'array', items: { type: 'string' }, description: 'Absolute source file paths' } },
      },
    })
    await $.tool.register({
      name: 'assumptions',
      description: LEDGER_DESC,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          reset: { type: 'boolean', description: 'Start a new ledger for a new task' },
          add: { type: 'array', items: { type: 'string' }, description: 'Assumptions to record, one fact each' },
          targets: {
            type: 'array',
            items: { type: 'string' },
            description: 'Repositories (absolute path), services or contracts the change must reach',
          },
          mark: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: 'The target number (T1 is 1)' },
                state: { type: 'string', enum: ['done', 'na'] },
                note: { type: 'string', description: 'What changed there, or why it needs nothing' },
              },
              required: ['id', 'state', 'note'],
            },
          },
          verify: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                holds: { type: 'boolean' },
                evidence: { type: 'string', description: 'The proof, in a few words' },
              },
              required: ['id', 'holds', 'evidence'],
            },
          },
        },
      },
    })
    reads.clear()
    asks = []
    restore = undefined
    previewed.clear()
    Object.assign(tokens, noTokens()) // /clear starts the session's figures over
    requestsDone = 0
    costDone = 0
    isGuardOn = isOn('guard')
    frozen = undefined
    setCache(null)
    turnOutput = ''
    seenHashes.clear()
    startChecks = checkAll($)
    if (isOn('intro')) {
      play($)
    } else {
      // no intro: the checklist shows only when something is missing
      void startChecks.then(() => {
        isListShown = isLacking()
        $.ui.invalidate('ui.render')
      })
    }
    void refreshStatus($)
    void scanNotice($)
    if (isOn('usageHeader')) {
      await refreshUsage($)
      usageMinute?.cancel()
      // countdowns tick each minute
      usageMinute = $.clock.every(60_000, () => void refreshUsage($).then(() => snap && warnIfCold($, snap.now)))
      animateUsage($)
    }
    return next(e)
  })

  let scanItems: ScanItem[] = [] // the last scan's numbered list, for `install <n>`
  on('command.run', { command: 'van-code-scan' }, async ($, e) => {
    const [sub, ...rest] = e.args.split(/\s+/).filter(Boolean)
    if (sub !== 'install') {
      const scanned = roots.length > 0 ? roots : [cwd]
      const hashes = await manifestHashes(p => $.fs.read(p), scanned)
      const cache = (await $.store.get(cacheKey(scanned))) as ScanCache | undefined
      if (sub !== 'refresh' && cache && !isStale(cache) && changedRoots(cache.hashes, hashes).length === 0) {
        scanItems = cache.items
        const when = new Date(cache.at).toISOString().slice(0, 10)
        return { text: `${cache.text}\n(saved scan from ${when}, no dependency changed since; /van-code-scan refresh asks again)`, isTextDisplayOnly: true }
      }
      $.ui.toast('Scanning the stack: dependencies, then GitHub and the docs sites...')
      const scan = await stackScan($, scanned)
      scanItems = scan.items
      await $.store.set(cacheKey(scanned), { hashes, text: scan.text, items: scan.items, at: Date.now() } satisfies ScanCache)
      return { text: scan.text, isTextDisplayOnly: true }
    }
    const picked = rest.map(n => scanItems[Number(n) - 1])
    if (rest.length === 0 || picked.some(p => !p))
      return { text: scanItems.length === 0 ? 'Run /van-code-scan first.' : `Pick numbers from 1 to ${scanItems.length}: /van-code-scan install 1 3`, isTextDisplayOnly: true }
    const lines: string[] = []
    for (const item of picked as ScanItem[]) {
      $.ui.toast(`Instalando ${item.name}...`)
      let ok = true
      for (const c of item.commands) {
        const r = await run($, c.split(' '), 300_000)
        // a marketplace added before fails to add again; the install after it decides
        if (!r.ok && !c.includes('marketplace add')) {
          ok = false
          lines.push(`${item.name}: \`${c}\` failed: ${r.out.trim().split('\n').at(-1)}`)
          break
        }
      }
      if (ok) lines.push(`${item.name}: installed`)
    }
    if (lines.some(l => l.endsWith(': installed'))) {
      lines.push('Running /reload-plugins so it takes effect now...')
      $.clock.after(500, () => void $.command.run({ command: 'reload-plugins' }).catch(() => {}))
    }
    return { text: lines.join('\n'), isTextDisplayOnly: true }
  })

  on('command.run', { command: 'van-code-stats' }, () => ({ text: statsText(), isTextDisplayOnly: true }))

  on('command.run', { command: 'van-code-guard' }, () => {
    isGuardOn = !isGuardOn
    if (!isGuardOn) stats.guardOffs += 1
    return {
      text: isGuardOn
        ? 'Guard on: heavy files only in slices.'
        : 'Guard off for this session: Claude may read any file whole.',
      isTextDisplayOnly: true,
    }
  })

  // Heavy files only in slices, unless the person turned the guard off.
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const isSlice = e.limit !== undefined && e.limit <= SLICE_MAX
    const heavySz = isGuardOn && !isSlice ? await heavySize($, e.file_path) : undefined
    if (heavySz !== undefined) {
      stats.heavyBlocked += 1
      stats.heavyTokens += Math.round(heavySz / 4)
      return {
        deny:
          `Jean-Claude Van Code: ${e.file_path} is a heavy file ${HEAVY_WHAT}. ` +
          `Use Grep to find what you need, or Read it with offset/limit (limit up to ${SLICE_MAX}).` +
          (BULKY.test(e.file_path) ? BULKY_HINT : '') +
          ' ' +
          'If the whole file is truly needed, ask the user to run /van-code-guard.',
      }
    }
    const pdfKey = readKey(e.agentId, e.file_path)
    if (/\.pdf$/i.test(e.file_path) && onceWarned.has(pdfKey)) insisted('pdf', pdfKey)
    if (status.indra === 'ok' && /\.pdf$/i.test(e.file_path) && pdfPages(e.pages) >= OCR_MIN_PAGES && !onceWarned.has(pdfKey)) {
      onceWarned.add(pdfKey)
      stats.pdfsToOcr += 1
      return {
        deny:
          `Jean-Claude Van Code: ${e.file_path} is cheaper as text. Run \`indra-ocr '${e.file_path}' --out <a temp folder>\` ` +
          '(local OCR; add --max-pages N for the first pages only) and Grep or Read the .md it writes; do not print it to stdout, ' +
          'long output gets cut. If you need the pages as images (figures, charts, layout), call Read again with the same arguments and it will go through.',
      }
    }
    if (e.limit === undefined || e.limit > SLICE_MAX) {
      const jq = await jsonDeny($, e.agentId, e.file_path)
      if (jq) return { deny: jq }
    }
    if (e.offset === undefined && e.limit === undefined) {
      const ol = await outlineDeny($, e.agentId, e.file_path)
      if (ol) return { deny: ol }
    }
    // a PDF is read by pages, not lines
    const range: Range = /\.pdf$/i.test(e.file_path)
      ? e.pages ? pdfRange(e.pages) : [1, Infinity]
      : readRange(e.offset, e.limit)
    const deny = await repeatDeny($, e.agentId, e.file_path, range)
    if (deny) return { deny }
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) await remember($, e.agentId, e.file_path, range)
    return ran
  }).catch(($, e, next) => next(e)) // a broken guard never blocks work

  // Reads through the shell: the same guard and memory as Read.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const parsed = parseShellRead(e.command)
    if (!parsed) return next(e)
    const cwd = await $.session.cwd()
    const files = parsed.reads.map(r => ({ ...r, path: resolvePath(cwd, parsed.dir, r.file) }))
    let heavy: (typeof files)[number] | undefined
    let heavySz = 0
    for (const r of isGuardOn ? files : []) {
      const sz = r.lines === undefined || r.lines > SLICE_MAX ? await heavySize($, r.path) : undefined
      if (sz !== undefined) {
        heavy = r
        heavySz = sz
        break
      }
    }
    if (heavy) {
      stats.heavyBlocked += 1
      stats.heavyTokens += Math.round(heavySz / 4)
      return {
        deny:
          `Jean-Claude Van Code: ${heavy.file} is a heavy file ${HEAVY_WHAT}. ` +
          `Use grep, or print a slice with head -n or sed -n 'A,Bp' (up to ${SLICE_MAX} lines).` +
          (BULKY.test(heavy.path) ? BULKY_HINT : '') +
          ' ' +
          'If the whole file is truly needed, ask the user to run /van-code-guard.',
      }
    }
    // the memory only for one file with known lines (not tail, not git show)
    const one = files.length === 1 && files[0]!.range ? files[0]! : undefined
    if (one && one.range![1] === Infinity) {
      const jq = await jsonDeny($, e.agentId, one.path)
      if (jq) return { deny: jq }
    }
    if (one && !parsed.isBypass) {
      const deny = await repeatDeny($, e.agentId, one.path, one.range!)
      if (deny) return { deny }
    }
    const ran = await next(e)
    if (one && ran.deny === undefined && !ran.isError) await remember($, e.agentId, one.path, one.range!)
    return ran
  }).catch(($, e, next) => next(e))

  // Live infrastructure: a change waits for a preview of its family, a destroy is refused once.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isOn('infraGuard')) return next(e)
    const found = judgeInfra(e.command)
    const held = found.find(v => (v.kind === 'change' && !previewed.has(v.family)) || v.kind === 'destroy')
    const key = `infra|${e.command.trim()}`
    if (held && onceWarned.has(key)) insisted('infra', key)
    if (held && !onceWarned.has(key)) {
      onceWarned.add(key)
      stats.infraBlocked += 1
      $.ui.toast(`Infra ${held.kind} held: Claude was told to preview it first`)
      return {
        deny:
          `Jean-Claude Van Code: this ${held.kind === 'destroy' ? 'deletes' : 'changes'} live infrastructure (${held.family}). ` +
          `Preview it first: ${held.hint}. Check the target (context, project, account, workspace) is the one the user means. ` +
          'If the user asked for this exact action, or the preview matches it, run the same command again and it will go through.',
      }
    }
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) for (const v of found) if (v.kind === 'preview') previewed.add(v.family)
    return ran
  }).catch(($, e, next) => next(e))

  // Git: discarding uncommitted work, or force-pushing, is refused once with what would be lost.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isOn('gitGuard')) return next(e)
    const found = judgeGit(e.command)
    const key = `git|${e.command.trim()}`
    if (!found) return next(e)
    if (onceWarned.has(key)) {
      insisted('git', key)
      return next(e)
    }
    let dirty = ''
    if (found.kind === 'discard') {
      // shortcut: status of the session folder (or `-C`), not of a `cd x &&` target; the deny names the folder checked.
      const dir = found.dir ? resolvePath(cwd, undefined, found.dir) : cwd
      try {
        const r = await $.process.run(['git', 'status', '--porcelain'], { ...(dir ? { cwd: dir } : {}), timeoutMs: 10_000 })
        if (r.exitCode !== 0) return next(e) // not a repository: git will say so itself
        dirty = r.stdout.trim()
      } catch {
        return next(e)
      }
      if (!dirty) return next(e) // nothing uncommitted to lose
    }
    onceWarned.add(key)
    stats.gitBlocked += 1
    $.ui.toast(`Git ${found.kind === 'force' ? 'force push' : 'discard'} held: Claude was told to check first`)
    const files = dirty.split('\n').slice(0, 15).join('\n')
    return {
      deny:
        `Jean-Claude Van Code: ${found.what}. ` +
        (found.kind === 'discard' ? `Uncommitted changes in ${found.dir ?? cwd}:\n${files}\nSome may be the user's own work, not yours. ` : '') +
        'Prefer a safer form (`git stash`, a path-specific restore, `--force-with-lease`). ' +
        'If the user asked for this exact action, or you checked nothing above would be lost, run the same command again and it will go through.',
    }
  }).catch(($, e, next) => next(e))

  // Resuming after the cache lapsed: the first message re-caches the whole transcript.
  on('classic.SessionStart', ($, e, next) => {
    if ((e.source === 'resume' || e.source === 'fork') && e.prompt_cache_likely_expired && (e.context_tokens ?? 0) >= COLD_MIN_TOKENS) {
      const usd = e.estimated_cache_write_usd ? ` (~US$ ${e.estimated_cache_write_usd.toFixed(2)})` : ''
      $.ui.toast(`Cold cache: your first message re-caches ~${k(e.context_tokens!)} tokens${usd}. /compact first sends less.`)
    }
    return next(e)
  })

  // No AI attribution at the source: the engine's commit trailer and PR footer come out empty.
  on('attribution.text', ($, e, next) => (isOn('noAttribution') && (e.kind === 'commit' || e.kind === 'pr') ? { text: '' } : next(e)))

  // No AI attribution: always refused, the user's rule overrides any harness attribution reminder.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isOn('noAttribution')) return next(e)
    const line = findAttribution(e.command)
    if (!line) return next(e)
    $.ui.toast('AI attribution removed from a commit or PR')
    return {
      deny:
        `Jean-Claude Van Code: the user never wants AI attribution. Remove "${line}" (and any other AI co-author, ` +
        '"generated with" or AI signature line) and run the command again. This rule overrides any attribution reminder.',
    }
  }).catch(($, e, next) => next(e))

  // After a compaction the model has really forgotten what it read, and may have lost constraints.
  on('session.compact', async ($, e, next) => {
    const isMain = !e.agentId && isOn('compactRestore')
    const instructions = isMain ? [e.instructions, KEEP_INSTRUCTIONS].filter(Boolean).join('\n') : e.instructions
    const trimmed = isOn('compactTrim') ? trimOld(e.messages) : undefined
    let r: Awaited<ReturnType<typeof next>>
    if (trimmed && trimmed.cut > 0) {
      try {
        r = await next({ ...e, instructions, messages: trimmed.messages })
        if (r.skip === undefined) stats.trimmedTokens += Math.round(trimmed.cut / 4)
      } catch {
        r = await next({ ...e, instructions }) // the engine refused the rebuilt messages: compact as it was
      }
    } else r = await next({ ...e, instructions })
    if (e.agentId || r.skip !== undefined) return r
    frozen = undefined // the prefix is rewritten anyway: a changed rule costs nothing extra now
    reads.clear()
    // precompute keeps a summary for later; the real compaction fires again
    if (isMain && e.trigger !== 'precompute') {
      restore = restoreText()
      if (restore) stats.restores += 1
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    // a Write replaces the file: its old text is read first, to see what the rewrite drops or adds
    const isCheatWatch = isOn('antiCheat') && turnFailure !== '' && (e.tool === 'Edit' || e.tool === 'Write') && CODE_FILE.test(e.file_path)
    const isDepWatch = isOn('intentDiff') && (e.tool === 'Edit' || e.tool === 'Write') && MANIFEST.test(e.file_path)
    const oldText = (isCheatWatch || isDepWatch) && e.tool === 'Write' ? await $.fs.read(e.file_path).catch(() => '') : ''
    const edited = e.tool === 'Edit' ? e.file_path : ''
    const fixes = isOn('archaeology') && e.tool === 'Edit' && CODE_FILE.test(e.file_path) ? await fixesBehind($, e.file_path, e.old_string, e.new_string).catch(() => []) : []
    let ran = await next(e)
    if (ran.deny !== undefined) return ran
    if (fixes.length > 0 && !ran.isError) {
      for (const f of fixes) archaeologySeen.add(`${edited}|${f.hash}`)
      stats.archaeology += 1
      $.ui.toast(`Archaeology: this edit removed lines from a fix (${fixes[0]!.summary.slice(0, 60)})`)
      ran = { ...ran, context: [...(ran.context ?? []), archaeologyNote(edited, fixes)] }
    }
    // an auto-compaction mid-turn: the restore rides on the next tool result, not a turn later
    if (restore && !e.agentId) {
      ran = { ...ran, context: [...(ran.context ?? []), restore] }
      restore = undefined
    }
    task.toolCalls += 1
    if (!e.agentId && ran.text) {
      // only a test or build run's own count: `12 passing` in a file being read is not a run
      if (e.tool === 'Bash' && verifySegments(e.command).length > 0) turnOutput = (turnOutput + '\n' + ran.text).slice(-TURN_OUTPUT_MAX)
      for (const h of hashesIn(ran.text)) seenHashes.add(h)
    }
    if (e.tool === 'Bash') {
      const who = e.agentId ?? 'main'
      const command = e.command.trim()
      const key = commandKey(command)
      const streak = failing.get(who) ?? []
      // an unrelated success (a `cat`, an `ls`) between attempts does not end the streak
      if (!ran.isError) {
        if (streak.at(-1)?.key === key) failing.delete(who)
      } else {
        const grown = nextStreak(streak, { command, key, error: errorLine(ran.text ?? '') })
        failing.set(who, grown)
        if (grown.length === LOOP_FAILS) {
          stats.loopsCaught += 1
          $.ui.toast(`${LOOP_FAILS} related commands failed in a row: Claude was told to change course`)
          return { ...ran, context: [...(ran.context ?? []), loopNote(grown)] }
        }
      }
    }
    if ((e.tool === 'Edit' || e.tool === 'Write') && CODE_FILE.test(e.file_path)) {
      hasUnverifiedEdit = true
      ranTests = [] // tests run before this edit prove nothing about it
      editedFiles.add(e.file_path)
      turnEdited.add(e.file_path)
    }
    if ((e.tool === 'Edit' || e.tool === 'Write') && !ran.isError && touchTargets(e.file_path)) $.ui.invalidate('ui.render')
    // a preview taken before this edit no longer shows what the change would do
    if ((e.tool === 'Edit' || e.tool === 'Write') && !ran.isError) for (const f of staleFamilies(e.file_path)) previewed.delete(f)
    if ((e.tool === 'Edit' || e.tool === 'Write') && !ran.isError && UI_FILE.test(e.file_path)) turnUi.add(e.file_path)
    // the official playwright plugin's MCP tools count as much as playwright-cli
    if ((e.tool === 'Bash' && BROWSER.test(e.command)) || /playwright/i.test(e.tool)) ranBrowser = true
    if (e.tool === 'Edit' && CODE_FILE.test(e.file_path)) {
      const minus = e.old_string.split('\n').map(l => `- ${l}`).join('\n')
      const plus = e.new_string.split('\n').map(l => `+ ${l}`).join('\n')
      recordChange(e.file_path, `--- ${e.file_path}\n${minus}\n${plus}`, Math.max(lineCount(e.old_string), lineCount(e.new_string)))
    }
    if (e.tool === 'Write' && CODE_FILE.test(e.file_path)) {
      recordChange(e.file_path, `+++ ${e.file_path} (whole file)\n${e.content}`, lineCount(e.content))
    }
    if (isCheatWatch && !ran.isError) {
      const [before, after] = e.tool === 'Edit' ? [e.old_string, e.new_string] : e.tool === 'Write' ? [oldText, e.content] : ['', '']
      const found = findCheats(e.file_path, before, after)
      if (found.length > 0) {
        stats.cheatsFlagged += 1
        $.ui.toast(`Anti-cheat: ${e.file_path.slice(e.file_path.lastIndexOf('/') + 1)} got ${found[0]} after a failure`)
        ran = { ...ran, context: [...(ran.context ?? []), cheatNote(e.file_path, found, turnFailure)] }
      }
    }
    // a dependency the request never named: flagged on the result that added it
    if (isOn('intentDiff') && !ran.isError && (isDepWatch || e.tool === 'Bash')) {
      const added =
        e.tool === 'Bash' ? installedDeps(e.command)
        : e.tool === 'Edit' ? addedDeps(e.file_path, e.old_string, e.new_string)
        : e.tool === 'Write' ? addedDeps(e.file_path, oldText, e.content)
        : []
      const unnamed = added.filter(d => !isNamed(d, recentAsks()))
      if (unnamed.length > 0) {
        stats.depsUnasked += unnamed.length
        $.ui.toast(`Intent diff: ${unnamed.join(', ')} added, the request never named it`)
        ran = { ...ran, context: [...(ran.context ?? []), depNote(unnamed, e.tool === 'Bash' ? 'this command' : `this edit of ${e.file_path}`)] }
      }
    }
    const verifies = e.tool === 'Bash' ? verifySegments(e.command) : []
    if (verifies.length > 0 && ran.isError) turnFailure ||= `a failing \`${verifies[0]}\``
    if (verifies.length > 0) {
      // a run of chosen tests proves the change only if one of them reaches it: judged at turn end
      const named = verifies.flatMap(namedTests)
      if (named.length > 0) ranTests.push(...named)
      else hasUnverifiedEdit = false
    }
    if (isOn('postEditCheck') && (e.tool === 'Edit' || e.tool === 'Write') && isCheckedEdit(e.tool, e.file_path)) {
      const who = e.agentId ?? 'main'
      const batch = editBatches.get(who) ?? { pending: 1, files: new Set<string>() }
      batch.pending -= 1
      if (!ran.isError) batch.files.add(e.file_path)
      editBatches.set(who, batch)
      // more edits of this response still to land: an error now may be one they fix
      if (batch.pending > 0) return ran
      editBatches.delete(who)
      const notes = (await Promise.all([...batch.files].map(f => checkEdited($, f)))).filter(Boolean) as string[]
      if (notes.length > 0) return { ...ran, context: [...(ran.context ?? []), ...notes] }
    }
    return ran
  })

  on('command.run', { command: 'chong-li' }, async $ => {
    if (isReviewing) return { text: 'Chong Li is already reviewing, hold on.', isTextDisplayOnly: true }
    let diff = takeUnreviewed()
    if (!diff) {
      // every repo Claude works in: a folder of side-by-side repos has no diff of its own
      const each = await Promise.all((roots.length ? roots : [cwd]).map(r => run($, ['git', '-C', r, 'diff', 'HEAD'])))
      diff = each.filter(g => g.ok).map(g => g.out).join('\n')
    }
    if (!diff.trim()) return { text: 'Chong Li has nothing to attack: no code changes.', isTextDisplayOnly: true }
    const found = await chongLi($, diff)
    return {
      text: found
        ? `Chong Li found a way to break it (he only saw the diff, so he may be wrong):\n${found}`
        : 'Chong Li found no way to break these changes.',
    }
  })

  // Automatic Chong Li review: only a big or risky change, never a chat turn.
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) setWorking(false)
    if (isOn('chongLi') && !e.agentId && unreviewed.length > 0 && (turnLines >= BIG_CHANGE || isTurnRisky) && !isReviewing) {
      const diff = takeUnreviewed()
      void chongLi($, diff).then(found => {
        if (!found) return
        $.ui.toast(`Chong Li found a way to break it: ${found.split('\n')[0]}`)
        notes.push(
          `[Jean-Claude Van Code / Chong Li] A cheap adversarial review of your last code changes (it saw only the diff, so it may be wrong) claims:\n${found}\nCheck whether this scenario really fails. Fix it if it is real, and tell the user either way in one line.`,
        )
      })
    }
    if (isOn('intentDiff') && !e.agentId && turnLines >= BIG_CHANGE && recentAsks()) {
      const diff = turnDiff.join('\n\n')
      void intentCheck($, recentAsks(), diff).then(found => {
        if (!found) return
        $.ui.toast(`Intent diff: ${found.split('\n')[0]}`)
        notes.push(
          `[Jean-Claude Van Code] Intent diff: a cheap check of your last changes against the user's request (it saw only the changes, so it may be wrong) says:\n${found}\nFor each Unasked item, remove it unless the user wants it; for each Missing one, do it or say why not. Tell the user in one line either way.`,
        )
      }).catch(() => {})
    }
    if (!e.agentId) {
      turnDiff = []
      turnFailure = ''
      turnLines = 0
      isTurnRisky = false
    }
    // a subagent's edits are part of the main turn: judged when the main turn ends
    if (isOn('proveIt') && !e.agentId && hasUnverifiedEdit) {
      hasUnverifiedEdit = false
      const touched = [...turnEdited]
      const ran = ranTests
      ranTests = []
      const nag = () => {
        notes.push(NOTE)
        $.ui.toast('Code edited with no test or build run: Claude will be asked to verify next turn')
      }
      // the test search can take seconds on a big repo: the note joins when it is done
      if (!touched.length) nag()
      else
        void (async () => {
          const isAllClean = touched.every(f => syntaxClean.has(f))
          // nothing ran and no clean check: no search needed to know it is unproven
          const isUnproven = ran.length === 0 && !isAllClean
          if (isUnproven) nag()
          const groups = await affectedTests($, touched)
          const tests = allTests(groups)
          if (isAllClean && tests.length === 0) return
          if (ran.length > 0 && reachesAny(ran, tests)) return
          if (isUnproven) {
            // already asked
          } else if (ran.length > 0) {
            stats.proofGaps += 1
            notes.push(
              `[Jean-Claude Van Code] In the previous turn you edited code and ran only ${ran.join(', ')}, which ${ran.length > 1 ? 'do' : 'does'} not import the files you changed, so ${ran.length > 1 ? 'they prove' : 'it proves'} nothing about the change. Run the tests that reach it, and say what you ran.`,
            )
            $.ui.toast('The tests Claude ran do not reach the edited code: it will be asked to run the right ones')
          } else nag()
          notes.push(await testsText($, touched, groups))
        })().catch(nag)
    }
    if (isOn('proveIt') && !e.agentId && hasWeb && !ranBrowser) {
      const fresh = [...turnUi].filter(f => !uiAsked.has(f))
      if (fresh.length > 0 && status.playwright === 'ok') {
        for (const f of fresh) uiAsked.add(f)
        stats.uiSuggested += 1
        notes.push(
          `[Jean-Claude Van Code] In the previous turn you changed user-facing code (${fresh.join(', ')}) and no browser saw it. If the change alters what a user sees or does, run the app and walk through that flow with playwright-cli as a user would, then say what you saw; if it does not, say so in one line.`,
        )
      } else if (fresh.length > 0 && status.playwright === 'missing' && !isPlaywrightOffered) {
        isPlaywrightOffered = true
        $.ui.toast('UI change with no browser check: /van-code-setup playwright lets Claude test it like a user')
      }
    }
    if (!e.agentId) {
      turnUi = new Set()
      ranBrowser = false
    }
    if (!e.agentId) turnEdited = new Set()
    if (!e.agentId && task.startedAt) {
      const done = { ...task }
      const used = taskTokens
      void $.session.usage().then(u => {
        if (u.cost) {
          requestsDone += 1
          costDone += u.cost.usd - done.costUsd
        }
        const cost = u.cost ? `~US$ ${(u.cost.usd - done.costUsd).toFixed(2)}, ` : ''
        lastTask = `${cost}${done.toolCalls} tool calls, ${duration(Date.now() - done.startedAt)}, ${used.requests} model requests, ${hitRate(used)}% of input from cache`
      }).catch(() => {})
    }
    if (isOn('suggestions') && !e.agentId && 'answer' in e) {
      const answer = e.answer
      suggestWait?.cancel()
      suggestWait = $.clock.after(SUGGEST_WAIT, () => void suggestFollowUp($, answer).catch(() => {}))
    }
    const open = ledger.filter(a => a.state === 'open')
    const unreached = targets.filter(t => t.state === 'open')
    if (!e.agentId && (open.length > 0 || unreached.length > 0) && 'answer' in e && DONE_CLAIM.test(e.answer)) {
      $.ui.toast(`Claimed done with ${open.length} unverified assumption(s), ${unreached.length} target(s) not reached`)
      notes.push(
        [
          '[Jean-Claude Van Code] Your last answer claimed the work was done while',
          open.length > 0 && `these assumptions were still unverified: ${open.map(a => `#${a.id} ${a.text}`).join('; ')}.`,
          unreached.length > 0 &&
            `${open.length > 0 ? 'And ' : ''}these targets were never reached nor marked n/a: ${unreached.map(t => `T${t.id} ${t.text}`).join('; ')}.`,
          'Finish them now, or tell the user plainly what is left.',
        ]
          .filter(Boolean)
          .join(' '),
      )
    }
    if (!e.agentId && 'answer' in e) {
      // the hashes seen live in memory, which a reload of the mod empties: the repository is the proof
      if (isOn('receipts'))
        for (const h of claimedHashes(e.answer).filter(h => ![...seenHashes].some(s => s.startsWith(h))))
          for (const r of roots.length ? roots : [cwd])
            if ((await run($, ['git', '-C', r, 'cat-file', '-e', `${h}^{commit}`], 10_000)).ok) {
              seenHashes.add(h)
              break
            }
      const bad = isOn('receipts') ? checkReceipts(e.answer, turnOutput, seenHashes) : []
      if (bad.length > 0) {
        stats.receiptsFlagged += bad.length
        $.ui.toast(`Receipts: ${bad.length} claim(s) in the last answer don't match the tool output`)
        notes.push(`[Jean-Claude Van Code] Receipts: your last answer claimed ${bad.join('; ')}. Correct it for the user in one line.`)
      }
      turnOutput = ''
    }
    void refreshStatus($)
    return next(e)
  })

  on('tool.run', { tool: TESTS_TOOL_RX }, async ($, e) => {
    const asked = (e as unknown as { files?: string[] }).files
    const text = await testsText($, asked?.length ? asked : [...editedFiles])
    return { result: text, text }
  })

  on('tool.run', { tool: LEDGER_TOOL_RX }, ($, e) => {
    applyLedger(e as unknown as LedgerInput)
    isLedgerShown = !isLedgerEmpty()
    $.ui.invalidate('ui.render')
    return { result: ledgerText(), text: ledgerText() }
  })

  // Note when the engine's own guess shows, so ours stays out of its way.
  on('prompt.suggest', async ($, e, next) => {
    if (isRepeat(e.text, lastSent)) return { isShown: false } // never offer what was just sent
    const r = await next(e)
    if (e.origin.kind === 'suggestion' && r.isShown) isEngineSuggested = true
    return r
  })

  // Every model request, main or subagent: where its input came from (uncached, cache read, cache write).
  on('turn.step', async function* ($, e, next) {
    const at = e.agentId ? 0 : await $.clock.now() // a cache lifetime counts from the request's start
    const r = yield* next(e)
    if (r.usage) addTokens(r.usage)
    if (r.usage && !e.agentId) {
      const u = r.usage
      setCache({ at, ttl: ttlOf(u, cache?.ttl), tokens: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens })
      isColdWarned = false
    }
    // the code edits this response asks for, so the post-edit check waits for the last of them
    const who = e.agentId ?? 'main'
    const edits = r.toolUses.filter(u => isCheckedEdit(u.name, (u.input as { file_path?: string } | null)?.file_path ?? ''))
    // shortcut: an edit that never reaches tool.call (denied, aborted) leaves its batch unchecked; the next step starts over
    if (edits.length > 0) editBatches.set(who, { pending: edits.length, files: new Set() })
    else editBatches.delete(who)
    return r
  })

  on('session.measure', async ($, e, next) => {
    void refreshStatus($)
    void scanNotice($)
    if (isOn('usageHeader')) {
      await refreshUsage($)
      animateUsage($)
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    frozen ??= composeOurs($)
    return { ...r, sections: [...r.sections, ...(await frozen)] }
  })

  on('command.run', { command: 'van-code' }, $ => {
    play($)
    void checkAll($)
    return { text: 'Hi-yah!', isTextDisplayOnly: true }
  })

  // Any slash command, the mod's or not: remembered so it is not suggested again.
  on('command.run', ($, e, next) => {
    lastSent = `/${e.command} ${e.args}`.trim()
    return next(e)
  })

  // No args: every recommended item missing. Args: those items, optional ones included.
  on('command.run', { command: 'van-code-setup' }, async ($, e) => {
    if (isInstalling) return { text: 'Already installing, hold on.', isTextDisplayOnly: true }
    const asked = e.args.split(/\s+/).filter(Boolean)
    const unknown = asked.filter(a => !RECS.some(r => r.id === a))
    if (unknown.length > 0) {
      return { text: `Unknown: ${unknown.join(', ')}. Options: ${RECS.map(r => r.id).join(', ')}`, isTextDisplayOnly: true }
    }
    isInstalling = true
    $.ui.invalidate('ui.render')
    try {
      await checkAll($)
      const missing = RECS.filter(r =>
        status[r.id] === 'missing' && (asked.length ? asked.includes(r.id) : !r.isOptional),
      )
      if (missing.length === 0) return { text: 'Nothing to install: all set.', isTextDisplayOnly: true }
      const lines: string[] = []
      for (const r of missing) {
        $.ui.toast(`Instalando ${r.id}...`)
        lines.push(await install($, r.id))
      }
      isListShown = true
      await checkAll($)
      // settings.json changes (rtk's hook, env caps) need a restart; plugins only a reload
      const installed = missing.filter(r => status[r.id] === 'ok')
      const restart = installed.some(r => r.id === 'rtk' || r.id === 'config') ? 'restart' : 'reload-plugins'
      if (installed.length > 0) {
        lines.push(`Running /${restart} so it takes effect now...`)
        // queued after this command finishes: the engine runs it once the session is idle
        $.clock.after(500, () => void $.command.run({ command: restart }).catch(() => {}))
      }
      return { text: lines.join('\n'), isTextDisplayOnly: true }
    } finally {
      isInstalling = false
      $.ui.invalidate('ui.render')
    }
  })

  // The checklist leaves once the person starts working.
  on('prompt.submit', ($, e, next) => {
    setWorking(true)
    if (isOn('usageHeader')) animateUsage($)
    lastUserText = e.text
    // a pasted story, bug or task card: plan it before coding (the note rides with the card itself)
    const kind = isOn('cardPlan') ? cardKind(e.text) : undefined
    if (kind) {
      notes.push(cardNote(kind, status.playwright === 'ok', status['diagnosing-bugs'] === 'ok'))
      stats.cards += 1
      $.ui.toast(`Read as a ${kind === 'task' ? 'task card' : kind === 'bug' ? 'bug report' : 'user story'}: Claude will plan it before coding`)
    }
    if (e.text.trim()) asks.push(e.text.trim())
    if (restore) {
      notes.push(restore)
      restore = undefined
    }
    task = { costUsd: 0, startedAt: Date.now(), toolCalls: 0 }
    taskTokens = noTokens()
    void $.session.usage().then(u => (task.costUsd = u.cost?.usd ?? 0)).catch(() => {})
    lastSent = e.text
    if (lastSuggested && e.text.trim() === lastSuggested) stats.suggestTaken += 1
    lastSuggested = ''
    isEngineSuggested = false
    suggestWait?.cancel()
    if (isListShown && isDone) {
      isListShown = false
      $.ui.invalidate('ui.render')
    }
    if (isLedgerShown && !isLedgerOpen()) {
      isLedgerShown = false
      $.ui.invalidate('ui.render')
    }
    if (notes.length === 0) return next(e)
    const extra = notes
    notes = []
    return next({ ...e, context: [...(e.context ?? []), ...extra] })
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const isTerminal = e.surface === 'terminal'
    const hasUsage = isOn('usageHeader') && snap !== null
    if (e.props.hasSurvey || (!hasUsage && (!isTerminal || (isDone && !isListShown && !isLedgerShown)))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const usage = hasUsage && snap ? usageRows(snap) : []
    if (!isTerminal) return <Box flexDirection="column">{usage}</Box>
    // shortcut: below MIN_W the scene is clipped on the right; fine for normal terminals.
    const w = Math.max(MIN_W, Math.min(MAX_W, e.props.bodyColumns))
    function usageRows(s: NonNullable<typeof snap>) {
      const f = usageFrame
      const w = e.props.bodyColumns
      const isBusy = e.props.isWorking
      const cacheMin = cacheLeft(cache, s.now)
      // separator: a bright comet sweeps across while working
      const head = isBusy ? (f % (w + 12)) - 12 : -99
      const sep = Array.from({ length: w }, (_, i) => {
        const d = i - head
        return d >= 0 && d < 12 ? (d > 8 ? '━' : '─') : null
      })
      const before = head < 0 ? 0 : Math.min(w, head)
      const comet = sep.slice(before).findIndex(c => c === null)
      const cometLen = comet === -1 ? w - before : comet
      return [
        <Text key="u-sep">
          <Text key="a" color="gray">{'─'.repeat(before)}</Text>
          <Text key="b" color="cyan" bold>{sep.slice(before, before + cometLen).join('')}</Text>
          <Text key="c" color="gray">{'─'.repeat(Math.max(0, w - before - cometLen))}</Text>
        </Text>,
        <Box key="u-row">
          <Text key="spin" color={isBusy ? 'cyan' : 'gray'}>{isBusy ? SPIN[f % SPIN.length] : '●'} </Text>
          <Text key="model" bold color="cyan">{prettyModel(s.model)}</Text>
          {s.limits.map(l => {
            const from = shown[l.kind] ?? 0
            const v = (shown[l.kind] = from + (l.percentUsed - from) * 0.25)
            const [fill, empty] = bar(v)
            const c = usageColor(l.percentUsed)
            return (
              <Text key={l.kind}>
                <Text key="s" color="gray">{'  │  '}</Text>
                <Text key="n" bold>{NAMES[l.kind] ?? l.kind} </Text>
                <Text key="f" color={c}>{fill}</Text>
                <Text key="e" color="gray">{empty}</Text>
                <Text key="p" color={c} bold> {Math.round(v)}%</Text>
                {l.percentUsed >= 90 && <Text key="w" color="red"> ⚠</Text>}
                <Text key="t" dimColor> ({left(l.resetsAt, s.now)})</Text>
              </Text>
            )
          })}
          {s.limits.length === 0 && <Text key="none" dimColor>{'  │  '}no limit data yet</Text>}
          {s.contextPercent !== undefined && (
            <Text key="ctx">
              <Text key="s" color="gray">{'  │  '}</Text>
              <Text key="l" bold>ctx </Text>
              <Text key="v" color={usageColor(s.contextPercent)}>{Math.round(s.contextPercent)}%</Text>
            </Text>
          )}
          {cacheMin !== undefined && (
            <Text key="cache">
              <Text key="s" color="gray">{'  │  '}</Text>
              <Text key="l" bold>cache </Text>
              <Text key="v" color={cacheMin <= 2 ? 'yellow' : 'green'}>{cacheMin === 0 ? 'cold' : `${cacheMin}m`}</Text>
            </Text>
          )}
        </Box>,
      ]
    }
    const scene = isDone
      ? []
      : cells(pixels(f, w)).map((row, y) => {
          // merge neighbours of the same colors into one span
          const spans: Cell[] = []
          for (const c of row) {
            const last = spans[spans.length - 1]
            if (last && last.fg === c.fg && last.bg === c.bg) last.ch += c.ch
            else spans.push({ ...c })
          }
          return (
            <Text key={`r${y}`} wrap="clip">
              {spans.map((s, i) => (
                <Text key={`s${i}`} color={s.fg} backgroundColor={s.bg}>
                  {s.ch}
                </Text>
              ))}
            </Text>
          )
        })
    const isMissing = isLacking()
    const counts = { open: 0, true: 0, false: 0 }
    for (const a of ledger) counts[a.state] += 1
    const ledgerRows =
      !isLedgerShown
        ? []
        : [
            <Text key="lg-head" wrap="truncate">
              <Text key="t" color="#D97757" bold>Assumptions </Text>
              <Text key="c" dimColor>{`✔ ${counts.true}  ✘ ${counts.false}  ? ${counts.open}`}</Text>
            </Text>,
            // shortcut: shows the last 6; the tool's text has the whole ledger.
            ...ledger.slice(-6).map(a => (
              <Text key={`lg-${a.id}`} wrap="truncate">
                <Text key="m" color={a.state === 'true' ? '#6cc070' : a.state === 'false' ? '#e06c5f' : '#F5C542'}>
                  {` ${a.state === 'true' ? '✔' : a.state === 'false' ? '✘' : '?'} `}
                </Text>
                <Text key="x" dimColor={a.state === 'true'}>{`${a.text}${a.evidence ? ` · ${a.evidence}` : ''}`}</Text>
              </Text>
            )),
            ...targets.slice(-6).map(t => (
              <Text key={`tg-${t.id}`} wrap="truncate">
                <Text key="m" color={t.state === 'open' ? '#F5C542' : '#6cc070'}>
                  {` ${t.state === 'open' ? '◇' : t.state === 'done' ? '◆' : '–'} `}
                </Text>
                <Text key="x" dimColor={t.state !== 'open'}>{`T${t.id} ${t.text}${t.note ? ` · ${t.note}` : ''}`}</Text>
              </Text>
            )),
          ]
    const list = isListShown
      ? [
          <Text key="head" color="#D97757" bold>
            Factory equipment
          </Text>,
          ...RECS.map(r => {
            const st = status[r.id] ?? 'checking'
            const isOffer = st === 'missing' && r.isOptional // optional: offered, never nagged
            const mark = st === 'ok' ? '✔' : isOffer ? '○' : st === 'missing' ? '✘' : st === 'none' ? '–' : '…'
            const color = st === 'ok' ? '#6cc070' : isOffer || st === 'none' ? undefined : st === 'missing' ? '#e06c5f' : undefined
            const desc =
              r.id === 'lsp' && langs.length > 0 ? `${r.desc} (${langs.map(l => l.name).join(', ')})`
              : r.id === 'lsp' && st === 'none' ? 'no known language in this folder'
              : r.id === 'infra' && infra.length > 0 ? `${r.desc} (${infra.map(i => i.name).join(', ')})`
              : r.id === 'infra' && st === 'none' ? 'no Terraform, Helm or Kubernetes files in this repo'
              : r.id === 'playwright' && st === 'none' ? 'no web frontend in this folder'
              : r.desc
            const tail = isOffer ? ` · optional: /van-code-setup ${r.id}` : st === 'missing' ? ' (missing)' : ''
            return (
              <Text key={`rec-${r.id}`} wrap="truncate">
                <Text key="m" color={color}>{` ${mark} ${r.id.padEnd(18)}`}</Text>
                <Text key="d" dimColor>
                  {desc + tail}
                </Text>
              </Text>
            )
          }),
          ...(isMissing
            ? [
                <Text key="hint" color="#F5C542">
                  {isInstalling ? ' installing...' : ' → run /van-code-setup to install what is missing'}
                </Text>,
              ]
            : []),
        ]
      : []
    return (
      <Box flexDirection="column">
        {scene}
        {list}
        {ledgerRows}
        {usage}
      </Box>
    )
  })
}
