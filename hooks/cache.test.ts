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

test('a push with a big context suggests a checkpoint compact, once per 100k of growth', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: string; message?: string }).text ?? (e as { message?: string }).message ?? e))
    return { value: undefined } as never
  })
  on('session.cwd', () => ({ value: '/p' }) as never)
  on('clock.now', () => ({ value: 0 }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  let context = 0
  on('turn.step', async function* () {
    const usage = { input_tokens: 0, cache_read_input_tokens: context, cache_creation_input_tokens: 0, output_tokens: 0, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 } }
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  } as never)
  // a model request of this many tokens, as the engine reports it
  const request = async (tokens: number) => {
    context = tokens
    const s = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 } as never)
    for await (const _ of s);
  }
  const push = () => $.tool.call({ tool: 'Bash', command: 'rtk git push -q' } as never)
  const tips = () => toasts.filter(t => t.startsWith('Checkpoint'))
  await request(120_000)
  await push()
  expect(tips()).toHaveLength(0) // small enough
  await request(210_000)
  await push()
  await push()
  expect(tips()).toEqual([expect.stringContaining('~210.0k tokens')])
  await request(320_000)
  await push()
  expect(tips()).toHaveLength(2)
})
