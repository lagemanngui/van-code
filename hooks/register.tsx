import type { EngineInterface, ModelUsage, PluginOptions, Register } from 'claude-code'

import { affectedTests, checkFile, testsText } from './checks.js'
import { isCovered, parseShellRead, type Range, readRange, resolvePath } from './reads.js'
import { checkAll, install, isLacking, langs, RECS, run, setCwd, status } from './factory.js'
import { type Cell, cells, LAST, MAX_W, MIN_W, pixels } from './intro.js'
import {
  animateUsage,
  bar,
  left,
  NAMES,
  prettyModel,
  refreshUsage,
  setWorking,
  shown,
  snap,
  SPIN,
  usageColor,
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
  heavyTokens: 0,
  checkCatches: 0,
  chongRuns: 0,
  chongFindings: 0,
  suggestShown: 0,
  suggestTaken: 0,
  haikuIn: 0,
  haikuOut: 0,
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
    `Heavy files blocked: ${stats.heavyBlocked} (~${k(stats.heavyTokens)} tokens) · guard ${onOff(isGuardOn)}`,
    `PDFs pointed to Indra OCR: ${stats.pdfsToOcr} · ${status.indra === 'ok' ? 'indra installed' : 'indra not installed'}`,
    `Big JSON pointed to jq: ${stats.jsonToJq} · ${status.jq === 'ok' ? 'jq installed' : 'jq not installed'}`,
    `Loops caught (the same command failing ${LOOP_FAILS} times in a row): ${stats.loopsCaught}`,
    lastTask ? `Last request: ${lastTask}` : 'Last request: none finished yet',
    `Errors caught right after an edit: ${stats.checkCatches} (type or syntax errors the post-edit check found in an edited file · post-edit check ${onOff(isOn('postEditCheck'))})`,
    `Chong Li: ${stats.chongRuns} reviews, ${stats.chongFindings} findings`,
    `Mod suggestions: ${stats.suggestShown} shown, ${stats.suggestTaken} taken`,
    `Haiku calls: ${k(stats.haikuIn)} input tokens, ${k(stats.haikuOut)} output tokens`,
  ].join('\n')
}

// Heavy files: lockfiles, dependencies, build output, minified bundles.
const HEAVY =
  /(^|\/)(node_modules|dist|\.next|coverage|vendor|\.git|__pycache__)\/|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock)$|\.min\.(js|css)$|\.map$/
const SLICE_MAX = 300
let isGuardOn = true

// "Prove it works": code edited in a turn with no test/build/type-check after.
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|scala|sh|vue|svelte|gd|lua|ex|exs|dart)$/
const VERIFY =
  /\b(test|tests|pytest|jest|vitest|mocha|tsc|build|lint|eslint|check|validate|cargo|go (test|build|vet)|make|gradle|mvn|swift (build|test)|xcodebuild|ruff|mypy|rspec|shellcheck|py_compile)\b|\b(ba|z|da)?sh -n\b/
let hasUnverifiedEdit = false
// Notes the model reads with the person's next message.
let notes: string[] = []
const NOTE =
  '[Jean-Claude Van Code] In the previous turn you edited code but ran no test, build or type-check afterwards. Verify that change before building on it, and say what you ran.'

// Assumption ledger: what a plan rests on, each checked before code is written.
type Assumption = { id: number; text: string; state: 'open' | 'true' | 'false'; evidence?: string }
type LedgerInput = {
  reset?: boolean
  add?: string[]
  verify?: { id: number; holds: boolean; evidence: string }[]
}
let ledger: Assumption[] = []
let isLedgerShown = false // shown from its first entry until a new message finds nothing open
const LEDGER_TOOL_RX = /^mcp__van-code__assumptions$/
const DONE_CLAIM = /\b(pronto|funciona|feito|conclu[ií]d[oa]|resolvid[oa]|corrigid[oa]|done|works|fixed|complete[d]?)\b/i
const LEDGER_DESC = `Assumption ledger. For a non-trivial task (several files, an unfamiliar API or library, a design choice), call it BEFORE writing code:
1. reset: true, then add: every assumption the plan rests on, one fact each ("fs.stat rejects on a missing path", "only X calls Y").
2. Check each with the cheapest proof (read the types or docs, grep, run one line) and record verify: { id, holds, evidence } with the evidence in a few words.
3. An assumption that does not hold means re-plan before coding.
Do not claim the work is done while any assumption is still open; name the open ones instead. Returns the ledger.`

function ledgerText() {
  if (ledger.length === 0) return 'Ledger is empty.'
  return ledger
    .map(a => `#${a.id} [${a.state === 'open' ? 'OPEN' : a.state === 'true' ? 'HOLDS' : 'FALSE'}] ${a.text}${a.evidence ? ` (evidence: ${a.evidence})` : ''}`)
    .join('\n')
}

function applyLedger(input: LedgerInput) {
  if (input.reset) ledger = []
  for (const text of input.add ?? []) ledger.push({ id: ledger.length + 1, text, state: 'open' })
  for (const v of input.verify ?? []) {
    const a = ledger.find(x => x.id === v.id)
    if (a) Object.assign(a, { state: v.holds ? 'true' : 'false', evidence: v.evidence })
  }
}

// Context alarm: warn once past 60%, re-arm under 50% (after a /compact or /clear).
let isContextWarned = false

const RULES = `# Jean-Claude Van Code
- Assertive: verify before you claim. If unsure, check with a tool instead of guessing, and say plainly what you did not check.
- Economical: Grep or Glob first, then Read only the slice you need (offset/limit). Never read lockfiles, dependencies, build output or minified files whole.
- Direct: lead with the answer. No preamble, no recap of what was already said.
- Proven: before calling a code change done, run the relevant test, build or type-check and report the result.
- Tests: to verify a change, call affected_tests and run only those tests, not the whole suite.
- Assumptions: on a non-trivial task, record what the plan rests on in the assumptions tool and verify each before writing code.`

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

// Big JSON: sliced with jq rather than read whole.
const JSON_MAX = 32_000 // bytes
const JQ_RULE = '- JSON: slice a big JSON file with jq (`jq keys`, `jq \'.path\'`) instead of reading it whole.'
async function jsonDeny($: EngineInterface, agentId: string | undefined, file: string) {
  if (status.jq !== 'ok' || !/\.json$/i.test(file)) return undefined
  const key = readKey(agentId, file)
  if (onceWarned.has(key)) return undefined
  const st = await $.fs.stat(file).catch(() => undefined)
  if (!st || st.size <= JSON_MAX) return undefined
  onceWarned.add(key)
  stats.jsonToJq += 1
  return (
    `Jean-Claude Van Code: ${file} is ${Math.round(st.size / 1000)} KB of JSON. Slice it with jq: \`jq keys\` for its shape, then \`jq '.path.to.what.you.need'\`. ` +
    'If you truly need it whole, run the same read again and it will go through.'
  )
}

const ASTGREP_RULE =
  "- Code by structure: `ast-grep -p '<pattern>' -l <lang> [paths]` finds code by its shape (`fetch($$$)` calls, a function by signature) where a regex would be fragile; `$X` matches one node, `$$$` many."

// Loop detector: the same shell command failing again and again, per agent.
const LOOP_FAILS = 3
const failing = new Map<string, { command: string; count: number }>()

// The last finished request: what it cost and how much it did.
let task = { costUsd: 0, startedAt: 0, toolCalls: 0 }
let lastTask = ''
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
If you cannot name a concrete failing scenario, answer exactly: NONE
Otherwise answer in at most 3 short lines: the file and what breaks, then the input or state that triggers it.`

const lineCount = (t: string) => (t ? t.split('\n').length : 0)

function recordChange(file: string, text: string, lines: number) {
  unreviewed.push({ file, text, lines })
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
  if (!before || before.isWarned || !isCovered(before.ranges, range)) return undefined
  const now = await $.fs.stat(file).catch(() => undefined)
  if (!now || now.mtimeMs !== before.mtimeMs || now.size !== before.size || (await isCompactedSince($, agentId, before.anchor))) {
    reads.delete(key)
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
    isGuardOn = isOn('guard')
    if (isOn('intro')) {
      play($)
      void checkAll($)
    } else {
      // no intro: the checklist shows only when something is missing
      void checkAll($).then(() => {
        isListShown = isLacking()
        $.ui.invalidate('ui.render')
      })
    }
    void refreshStatus($)
    if (isOn('usageHeader')) {
      await refreshUsage($)
      usageMinute?.cancel()
      usageMinute = $.clock.every(60_000, () => void refreshUsage($)) // countdown ticks each minute
      animateUsage($)
    }
    return next(e)
  })

  on('command.run', { command: 'van-code-stats' }, () => ({ text: statsText(), isTextDisplayOnly: true }))

  on('command.run', { command: 'van-code-guard' }, () => {
    isGuardOn = !isGuardOn
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
    if (isGuardOn && !isSlice && HEAVY.test(e.file_path)) {
      const heavy = await $.fs.stat(e.file_path).catch(() => undefined)
      stats.heavyBlocked += 1
      stats.heavyTokens += Math.round((heavy?.size ?? 0) / 4)
      return {
        deny:
          `Jean-Claude Van Code: ${e.file_path} is a heavy file (lockfile, dependency, build output or minified). ` +
          `Use Grep to find what you need, or Read it with offset/limit (limit up to ${SLICE_MAX}). ` +
          'If the whole file is truly needed, ask the user to run /van-code-guard.',
      }
    }
    const pdfKey = readKey(e.agentId, e.file_path)
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
    const heavy = isGuardOn ? files.find(r => (r.lines === undefined || r.lines > SLICE_MAX) && HEAVY.test(r.path)) : undefined
    if (heavy) {
      const st = await $.fs.stat(heavy.path).catch(() => undefined)
      stats.heavyBlocked += 1
      stats.heavyTokens += Math.round((st?.size ?? 0) / 4)
      return {
        deny:
          `Jean-Claude Van Code: ${heavy.file} is a heavy file (lockfile, dependency, build output or minified). ` +
          `Use grep, or print a slice with head -n or sed -n 'A,Bp' (up to ${SLICE_MAX} lines). ` +
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

  // After a compaction the model has really forgotten what it read.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    reads.clear()
    return r
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    task.toolCalls += 1
    if (e.tool === 'Bash') {
      const who = e.agentId ?? 'main'
      const command = e.command.trim()
      if (!ran.isError) failing.delete(who)
      else {
        const before = failing.get(who)
        const count = before?.command === command ? before.count + 1 : 1
        failing.set(who, { command, count })
        if (count === LOOP_FAILS) {
          stats.loopsCaught += 1
          $.ui.toast(`The same command failed ${LOOP_FAILS} times in a row: Claude was told to change course`)
          return {
            ...ran,
            context: [
              ...(ran.context ?? []),
              `[Jean-Claude Van Code] This exact command has now failed ${LOOP_FAILS} times in a row. Stop retrying it. Read the error, find its cause, and change the approach, or tell the user what blocks you.`,
            ],
          }
        }
      }
    }
    if ((e.tool === 'Edit' || e.tool === 'Write') && CODE_FILE.test(e.file_path)) {
      hasUnverifiedEdit = true
      editedFiles.add(e.file_path)
      turnEdited.add(e.file_path)
    }
    if (e.tool === 'Edit' && CODE_FILE.test(e.file_path)) {
      const minus = e.old_string.split('\n').map(l => `- ${l}`).join('\n')
      const plus = e.new_string.split('\n').map(l => `+ ${l}`).join('\n')
      recordChange(e.file_path, `--- ${e.file_path}\n${minus}\n${plus}`, Math.max(lineCount(e.old_string), lineCount(e.new_string)))
    }
    if (e.tool === 'Write' && CODE_FILE.test(e.file_path)) {
      recordChange(e.file_path, `+++ ${e.file_path} (whole file)\n${e.content}`, lineCount(e.content))
    }
    if (e.tool === 'Bash' && VERIFY.test(e.command)) hasUnverifiedEdit = false
    if (isOn('postEditCheck') && (e.tool === 'Edit' || e.tool === 'Write') && CODE_FILE.test(e.file_path) && !ran.isError) {
      const found = await checkFile($, e.file_path)
      // a clean type-check is a verification; a syntax-only pass is not
      if (found?.isClean && (found.tool === 'tsc' || found.tool === 'go vet')) hasUnverifiedEdit = false
      // with no test to run, a clean syntax check is all the proof there is (judged at turn end)
      if (found?.isClean) syntaxClean.add(e.file_path)
      else syntaxClean.delete(e.file_path)
      if (found?.errors) {
        stats.checkCatches += 1
        return {
          ...ran,
          context: [
            ...(ran.context ?? []),
            `[Jean-Claude Van Code] ${found.tool} reports errors in ${e.file_path} after this edit:\n${found.errors}\nFix them before moving on.`,
          ],
        }
      }
    }
    return ran
  })

  on('command.run', { command: 'chong-li' }, async $ => {
    if (isReviewing) return { text: 'Chong Li is already reviewing, hold on.', isTextDisplayOnly: true }
    let diff = takeUnreviewed()
    if (!diff) {
      const git = await run($, ['git', 'diff', 'HEAD'])
      diff = git.ok ? git.out : ''
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
    if (!e.agentId) {
      turnLines = 0
      isTurnRisky = false
    }
    // a subagent's edits are part of the main turn: judged when the main turn ends
    if (isOn('proveIt') && !e.agentId && hasUnverifiedEdit) {
      hasUnverifiedEdit = false
      const touched = [...turnEdited]
      const nag = () => {
        notes.push(NOTE)
        $.ui.toast('Code edited with no test or build run: Claude will be asked to verify next turn')
      }
      // the test search can take seconds on a big repo: the note joins when it is done
      if (!touched.length) nag()
      else
        void (async () => {
          const isAllClean = touched.every(f => syntaxClean.has(f))
          if (isAllClean && (await affectedTests($, touched)).tests.length === 0) return
          nag()
          notes.push(await testsText($, touched))
        })().catch(nag)
    }
    if (!e.agentId) turnEdited = new Set()
    if (!e.agentId && task.startedAt) {
      const done = { ...task }
      void $.session.usage().then(u => {
        const cost = u.cost ? `~US$ ${(u.cost.usd - done.costUsd).toFixed(2)}, ` : ''
        lastTask = `${cost}${done.toolCalls} tool calls, ${duration(Date.now() - done.startedAt)}`
      }).catch(() => {})
    }
    if (isOn('suggestions') && !e.agentId && 'answer' in e) {
      const answer = e.answer
      suggestWait?.cancel()
      suggestWait = $.clock.after(SUGGEST_WAIT, () => void suggestFollowUp($, answer).catch(() => {}))
    }
    const open = ledger.filter(a => a.state === 'open')
    if (!e.agentId && open.length > 0 && 'answer' in e && DONE_CLAIM.test(e.answer)) {
      $.ui.toast(`Claimed done with ${open.length} unverified assumption(s)`)
      notes.push(
        `[Jean-Claude Van Code] Your last answer claimed the work was done while these assumptions were still unverified: ${open.map(a => `#${a.id} ${a.text}`).join('; ')}. Verify them now, or tell the user plainly that they are unverified.`,
      )
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
    isLedgerShown = ledger.length > 0
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

  on('session.measure', async ($, e, next) => {
    void refreshStatus($)
    if (isOn('usageHeader')) {
      await refreshUsage($)
      animateUsage($)
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!isOn('rules')) return r
    const text = [RULES, status.indra === 'ok' && OCR_RULE, status.jq === 'ok' && JQ_RULE, status['ast-grep'] === 'ok' && ASTGREP_RULE]
      .filter(Boolean)
      .join('\n')
    return { ...r, sections: [...r.sections, { id: 'van-code:rules', text, scope: 'session' as const }] }
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
    task = { costUsd: 0, startedAt: Date.now(), toolCalls: 0 }
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
    if (isLedgerShown && ledger.every(a => a.state !== 'open')) {
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
              r.id === 'lsp' && langs.length > 0 ? `${r.desc} (${langs.map(l => l.name).join(', ')})` : r.id === 'lsp' && st === 'none' ? 'no known language in this folder' : r.desc
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
