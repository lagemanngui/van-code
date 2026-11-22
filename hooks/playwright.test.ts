import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// A web repo (react in package.json); `installed` decides whether playwright-cli and its skill are there.
function world(on: On, installed: boolean) {
  const ran: string[] = []
  const toasts: string[] = []
  let context: readonly string[] = []
  on('fs.list', () => ({ value: [] }) as never)
  on('fs.read', (_, e) => ({ value: String((e as { path: string }).path).endsWith('package.json') ? '{"dependencies":{"react":"19"}}' : '' }) as never)
  on('fs.exists', (_, e) => ({ value: installed && String((e as { path: string }).path).endsWith('.claude/skills/playwright-cli/SKILL.md') }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }) as never)
  on('env.get', () => ({ value: '/home/u' }) as never)
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    ran.push(argv)
    const ok = e.argv[0] === 'which' ? installed && e.argv[1] === 'playwright-cli' : true
    return { value: { exitCode: ok ? 0 : 1, stdout: argv.includes('plugin list') ? '[]' : '', stderr: '' } } as never
  })
  on('settings.read', () => ({ value: {} }) as never)
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: string }).text ?? JSON.stringify(e)))
    return { value: undefined } as never
  })
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)
  on('command.run', () => ({ text: '' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  return { ran, toasts, context: () => context.join('\n') }
}
const settle = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}
const edit = (file_path: string) => ({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' }) as never

test('a UI change no browser saw: Claude is asked to walk the flow, once per file', async ($, on) => {
  const w = world(on, true)
  await $.command.run({ command: 'van-code', args: '' } as never)
  await settle()

  await $.tool.call(edit('/p/src/Checkout.tsx'))
  await $.turn.complete({ answer: 'ok' } as never)
  await settle()
  await $.prompt.submit({ text: 'next' } as never)
  expect(w.context()).toContain('walk through that flow with playwright-cli')

  // the same file again: not asked twice
  await $.tool.call(edit('/p/src/Checkout.tsx'))
  await $.turn.complete({ answer: 'ok' } as never)
  await settle()
  await $.prompt.submit({ text: 'again' } as never)
  expect(w.context()).not.toContain('playwright-cli as a user')

  // a browser run in the turn is the check
  await $.tool.call(edit('/p/src/Cart.tsx'))
  await $.tool.call({ tool: 'Bash', command: 'playwright-cli open http://localhost:5173' } as never)
  await $.turn.complete({ answer: 'ok' } as never)
  await settle()
  await $.prompt.submit({ text: 'more' } as never)
  expect(w.context()).not.toContain('Cart.tsx')
})

test('without playwright-cli the person is offered the setup once; setup installs the skill from HOME', async ($, on) => {
  const w = world(on, false)
  await $.command.run({ command: 'van-code', args: '' } as never)
  await settle()
  await $.tool.call(edit('/p/src/App.tsx'))
  await $.turn.complete({ answer: 'ok' } as never)
  await settle()
  expect(w.toasts.some(t => t.includes('/van-code:setup playwright'))).toBe(true)

  await $.command.run({ command: 'van-code:setup', args: 'playwright' } as never)
  expect(w.ran).toContain('npm install -g @playwright/cli@latest')
  expect(w.ran).toContain('playwright-cli install --skills')
})
