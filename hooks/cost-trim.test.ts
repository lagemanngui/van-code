import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { addTokens, noTokens, tokensLine, trimOld } from './register.js'

const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 100, model: 'm' }

test('the scoreboard splits input into uncached, cache read and cache write', () => {
  const t = noTokens()
  addTokens(USAGE, [t])
  addTokens(USAGE, [t])
  expect(tokensLine(t)).toBe('2 model requests · input 200 uncached, 1.6k cache read, 200 cache write (80% from cache) · output 100')
  expect(tokensLine(noTokens())).toContain('(0% from cache)')
})

const msg = (role: 'user' | 'assistant', text: string, results?: { text: string; isError?: boolean }[]): SessionMessage => ({
  role,
  text,
  toolUses: [],
  handle: `h-${text}`,
  ...(results ? { toolResults: results.map((r, i) => ({ tool_use_id: `${text}-${i}`, text: r.text, isError: r.isError ?? false })) } : {}),
})

test('old bulky tool output is cut before compaction; recent messages and errors stay whole', () => {
  const big = 'x'.repeat(5_000)
  const old = [msg('user', 'old', [{ text: big }, { text: 'short' }, { text: big, isError: true }])]
  const recent = Array.from({ length: 12 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `r${i}`, i % 2 ? undefined : [{ text: big }]))
  const { messages, cut } = trimOld([...old, ...recent])

  expect(cut).toBe(5_000 - 600)
  const first = messages[0]!
  expect(first.handle).toBeUndefined() // rebuilt from its fields
  expect(first.toolResults![0]!.text).toContain('chars of old tool output cut before compaction')
  expect(first.toolResults![0]!.text.length).toBeLessThan(700)
  expect(first.toolResults![1]!.text).toBe('short')
  expect(first.toolResults![2]!.text).toBe(big) // an error explains a decision
  expect(messages.slice(1)).toEqual(recent) // untouched, handles included
  expect(trimOld(recent).cut).toBe(0)
})

test('the compaction hands the summarizer the trimmed messages', async ($, on) => {
  let seen: readonly SessionMessage[] = []
  on('session.compact', (_, e) => {
    seen = e.messages
    return { messages: [msg('user', 'summary')] }
  })
  const big = 'y'.repeat(3_000)
  const all = [msg('user', 'old', [{ text: big }]), ...Array.from({ length: 12 }, (_, i) => msg('assistant', `r${i}`))]
  await $.session.compact({ trigger: 'manual', messages: all } as never)
  expect(seen[0]!.toolResults![0]!.text.length).toBeLessThan(700)
  expect(seen).toHaveLength(13)
})
