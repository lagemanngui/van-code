// Card detector: a pasted story, bug report or task card, by the markers trackers and
// templates put in them (Portuguese and English). Plain chat and pasted logs are not cards.
export type CardKind = 'bug' | 'story' | 'task'

const BUG = [
  /passos (para|pra|de) reprodu/i,
  /steps to reproduce|repro(duction)? steps/i,
  /(comportamento|resultado) (esperado|obtido|atual)/i,
  /(expected|actual) (behaviou?r|result|outcome)/i,
  /como reproduzir|how to reproduce/i,
]
const STORY = [
  /crit[ée]rios? de aceit(e|a[çc][ãa]o)/i,
  /acceptance criteria/i,
  /\bcomo (um|uma|o|a) [^\n]{1,80}\b(eu )?(quero|gostaria|preciso)/i,
  /\bas an? [^\n]{1,80}\bi (want|need)\b/i,
  /\buser story\b|\bhist[óo]ria de usu[áa]rio\b/i,
  /\bdado que\b[\s\S]{1,300}\bquando\b[\s\S]{1,300}\bent[ãa]o\b/i,
  /\bgiven\b[\s\S]{1,300}\bwhen\b[\s\S]{1,300}\bthen\b/i,
  /definition of done|defini[çc][ãa]o de (pronto|conclu[íi]do)/i,
]
// A ticket key (PROJ-123) in a long, structured message: a card of no clear kind.
const TICKET = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/
const TASK_MIN = 300 // chars

const lines = (text: string) => text.split('\n').filter(l => /^\s*([-*•]|\d+[.)]|#{1,6}\s|\[[ x]\])/.test(l)).length

// A long message needs two markers: one in passing ("define expected outcome") is a document, not a card.
const LONG = 4000 // chars
const isKind = (text: string, markers: RegExp[]) => markers.filter(r => r.test(text)).length >= (text.length > LONG ? 2 : 1)

export function cardKind(text: string): CardKind | undefined {
  if (isKind(text, BUG)) return 'bug'
  if (isKind(text, STORY)) return 'story'
  if (text.length >= TASK_MIN && TICKET.test(text) && lines(text) >= 3) return 'task'
  return undefined
}

const DONE = 'Mark each target done with the evidence that shows it (a test, or a run you watched), and do not say the work is done while one is open.'

// What the model is told along with the card. `hasBrowser`: playwright-cli is installed.
export function cardNote(kind: CardKind, hasBrowser: boolean, hasDiagnose = false): string {
  const head = '[Jean-Claude Van Code]'
  if (kind === 'bug')
    return [
      `${head} This message reads as a bug report. Before fixing it:`,
      ...(hasDiagnose ? ['0. If the cause is not plain after one read of the code involved, call the Skill tool with "diagnosing-bugs" and follow its loop; it covers the steps below.'] : []),
      `1. Reproduce it: a test that fails${hasBrowser ? ', or for a UI bug the steps walked in a browser with playwright-cli' : ', or the steps run'}, and show it failing. If you cannot reproduce it, say so and ask; do not guess a fix.`,
      '2. Find the cause, and record in the assumptions tool what the fix rests on; list as targets every repo or service the fix must reach.',
      '3. Fix it, then show the same reproduction passing and run the tests that reach the change.',
      DONE,
    ].join('\n')
  if (kind === 'story')
    return [
      `${head} This message reads as a user story. Before writing code:`,
      '1. List each acceptance criterion as a target in the assumptions tool (targets), and add the repos or services it touches.',
      '2. If a criterion is ambiguous in a way that changes what you build, ask the user, all such questions in one message, before coding. Otherwise state in one line the reading you chose and go on.',
      '3. Keep to the story: change nothing it does not ask for.',
      DONE,
    ].join('\n')
  return [
    `${head} This message reads as a task card. Before writing code, list as targets in the assumptions tool what "done" means for it and the repos or services it touches; ask only about ambiguities that change what you build.`,
    DONE,
  ].join('\n')
}
