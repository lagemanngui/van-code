// Receipts: claims in Claude's final answer checked against what the tools actually printed.
// Only what tool output can contradict outright is checked, so a flag is a real mismatch:
// a test count that differs from the turn's last test run, and a commit hash no tool ever showed.

const RUN_COUNT = /(\d+)\s+pass(?:ed|ing|es)?\b/gi // `76 pass`, `5 passed`, `12 passing`
const CLAIM_COUNT = /(\d+)\s+(?:testes?|tests?)\s+(?:passam|passaram|pass(?:ed|ing|es)?)\b/gi
const CLAIM_HASH = /`([0-9a-f]{7,12})`/g
const SEEN_HASH = /\b[0-9a-f]{7,40}\b/g

// Hex runs seen in tool output, to check claimed commit hashes against.
export const hashesIn = (text: string) => text.match(SEEN_HASH) ?? []

// The commit hashes an answer claims, digits-only runs left out.
export const claimedHashes = (answer: string) => [...answer.matchAll(CLAIM_HASH)].map(m => m[1]!).filter(h => !/^\d+$/.test(h))

// Each claim of the answer the tool output contradicts, as one line for Claude.
export function checkReceipts(answer: string, turnOutput: string, seenHashes: ReadonlySet<string>): string[] {
  const out: string[] = []
  const runs = [...turnOutput.matchAll(RUN_COUNT)]
  const last = runs.at(-1)?.[1]
  if (last !== undefined)
    for (const m of answer.matchAll(CLAIM_COUNT))
      if (m[1] !== last) out.push(`"${m[0]}", but the last test run of this turn printed "${last} pass"`)
  const seen = [...seenHashes]
  for (const m of answer.matchAll(CLAIM_HASH)) {
    const h = m[1]!
    if (/^\d+$/.test(h)) continue // all digits: a number, not a hash
    if (!seen.some(s => s.startsWith(h))) out.push(`commit \`${h}\`, which no tool output in this session showed`)
  }
  return out
}
