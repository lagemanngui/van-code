import { expect, test } from 'claude-code/testing'

import { status } from './factory.js'

const FACTS = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as never

test('the mod sections hold still when a check finishes mid-session, so the prompt cache holds', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  on('fs.read', () => ({ value: '' }) as never)
  const rules = async () => (await $.prompt.compose(FACTS)).sections.find(s => s.id === 'van-code:rules')?.text
  status.jq = 'checking'
  const first = await rules()
  status.jq = 'ok' // the startup check lands after the first request
  expect(await rules()).toBe(first)
  expect(first).not.toContain('jq keys')
})

test('resuming with a lapsed cache over a big transcript says what the first message costs', async ($, on) => {
  const toasts: string[] = []
  on('classic.SessionStart', () => ({})) // core's own answer
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: string; message?: string }).text ?? (e as { message?: string }).message ?? e))
    return { value: undefined } as never
  })
  await $.classic.SessionStart({ source: 'resume', prompt_cache_likely_expired: true, context_tokens: 120_000, estimated_cache_write_usd: 0.75 } as never)
  expect(toasts.join('\n')).toContain('re-caches ~120.0k tokens (~US$ 0.75)')
  toasts.length = 0
  await $.classic.SessionStart({ source: 'resume', prompt_cache_likely_expired: false, context_tokens: 120_000 } as never)
  await $.classic.SessionStart({ source: 'resume', prompt_cache_likely_expired: true, context_tokens: 5_000 } as never)
  expect(toasts).toEqual([])
})
