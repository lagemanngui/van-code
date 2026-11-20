// No AI attribution: commits, PRs, issues, tags and notes carry no AI co-author or "generated with" line.
const WRITES = /\b(git\s+(commit|tag|notes|merge)|gh\s+(pr|issue|release)\s+(create|edit|comment|merge))\b/
const AI = 'claude|anthropic|copilot|chatgpt|gpt|openai|gemini|cursor|codex|devin|aider|windsurf|\\bai\\b'
const LINES = [
  new RegExp(`co-authored-by:[^\\n]*(${AI})[^\\n"']*`, 'i'),
  new RegExp(`generated (with|by|using)[^\\n]*(${AI})[^\\n"']*`, 'i'),
  /noreply@anthropic\.com/i,
]

// The offending line, or undefined when the command writes no AI attribution.
export function findAttribution(command: string): string | undefined {
  if (!WRITES.test(command)) return undefined
  for (const re of LINES) {
    const m = command.match(re)
    if (m) return m[0].trim()
  }
  return undefined
}
