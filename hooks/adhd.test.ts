import { expect, test } from 'claude-code/testing'

const FACTS = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as never

test('the bundled ADHD skill is in every system prompt, without its frontmatter', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const skill = '---\nname: i-have-adhd\ndisable-model-invocation: true\n---\n\n# i-have-adhd\n\n### 1. Lead with the next action\n'
  on('fs.read', (_, e) => ({ value: String((e as { path: string }).path).endsWith('i-have-adhd/SKILL.md') ? skill : '' }) as never) // the engine's own composition
  const text = (await $.prompt.compose(FACTS)).sections.find(s => s.id === 'van-code:adhd')?.text ?? ''
  expect(text).toContain('ADHD MODE ACTIVE (always-on)')
  expect(text).toContain('Lead with the next action')
  expect(text).not.toContain('disable-model-invocation')
})

test('the engine is asked for no commit trailer and no PR footer', async $ => {
  expect((await $.attribution.text({ kind: 'commit', text: 'Co-Authored-By: Claude' })).text).toBe('')
  expect((await $.attribution.text({ kind: 'pr', text: 'Generated with Claude Code' })).text).toBe('')
})
