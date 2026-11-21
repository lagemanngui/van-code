import { expect, test } from 'claude-code/testing'

import { addedDeps, installedDeps, intentFindings, isNamed } from './intent.js'

test('dependencies added by a manifest edit or an install command', () => {
  expect(addedDeps('/p/package.json', '"dependencies": {\n  "react": "^18.0.0"', '"dependencies": {\n  "react": "^18.0.0",\n  "p-retry": "^6.2.0",\n  "@tanstack/react-query": "5.0.0"')).toEqual(['p-retry', '@tanstack/react-query'])
  expect(addedDeps('/p/package.json', '', '"version": "1.0.0",\n"scripts": { "test": "vitest" },\n"engines": { "node": ">=18" }')).toEqual([])
  expect(addedDeps('/p/requirements.txt', 'flask==3.0\n', 'flask==3.0\nrequests>=2.31\n# a comment\n-r base.txt')).toEqual(['requests'])
  expect(addedDeps('/p/go.mod', 'module x\n', 'module x\nrequire github.com/pkg/errors v0.9.1')).toEqual(['github.com/pkg/errors'])
  expect(addedDeps('/p/Cargo.toml', '[package]\nname = "x"\nversion = "0.1.0"', '[package]\nname = "x"\nversion = "0.1.0"\n[dependencies]\nserde = { version = "1" }')).toEqual(['serde'])

  expect(installedDeps('npm i -D p-retry@6 && pnpm add @scope/lib@^2')).toEqual(['p-retry', '@scope/lib'])
  expect(installedDeps('pip install "requests>=2" && pip install -r requirements.txt')).toEqual(['requests'])
  expect(installedDeps('npm install')).toEqual([]) // installs the lockfile
  expect(installedDeps('cargo add serde && go get github.com/pkg/errors@v0.9.1')).toEqual(['serde', 'github.com/pkg/errors'])
})

test('a dependency counts as asked when the request names it, or its last part', () => {
  expect(isNamed('@tanstack/react-query', 'use react-query for the list')).toBe(true)
  expect(isNamed('p-retry', 'add retries to the payment call')).toBe(false)
})

test('the model answer becomes findings, or nothing', () => {
  expect(intentFindings('NONE')).toBeUndefined()
  expect(intentFindings('Unasked: a retry config option\nnoise\nMissing: the status shown to the user')).toBe('Unasked: a retry config option\nMissing: the status shown to the user')
})

test('an install the request never named is flagged on its result', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('clock.every', () => ({ value: { cancel: () => {} } }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)
  await $.prompt.submit({ text: 'add retries to the payment call' } as never)
  const ran = await $.tool.call({ tool: 'Bash', command: 'npm i p-retry' } as never)
  expect((ran.context ?? []).join('\n')).toContain('Intent diff: this command added a dependency the request never named: `p-retry`')
  const asked = await $.tool.call({ tool: 'Bash', command: 'npm i payment' } as never)
  expect((asked.context ?? []).join('\n')).not.toContain('Intent diff')
})

test('a big turn is checked against the request; the finding reaches Claude with the next message', async ($, on) => {
  const BIG = Array.from({ length: 40 }, (_, i) => `const retry${i} = ${i}`).join('\n')
  const asked: string[] = []
  on('model.complete', (_, e) => {
    const isIntent = String(e.system).includes('asked their coding assistant for')
    if (isIntent) asked.push(String(e.prompt))
    return { value: { isAnswered: true, text: isIntent ? 'Unasked: a retry config option' : 'NONE', usage: {} } } as never
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('clock.every', () => ({ value: { cancel: () => {} } }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })

  await $.prompt.submit({ text: 'retry failed payments once' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/p/pay.ts', old_string: 'a', new_string: BIG })
  await $.turn.complete({ answer: 'done' } as never)
  for (let i = 0; i < 50; i++) await Promise.resolve()
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('retry failed payments once')
  expect(asked[0]).toContain('const retry39 = 39')
  await $.prompt.submit({ text: 'next' } as never)
  expect(context.join('\n')).toContain('Intent diff: a cheap check')
  expect(context.join('\n')).toContain('Unasked: a retry config option')
})
