import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const STAT = { kind: 'file', size: 10, mtimeMs: 1, isLink: false }

// `which indra-ocr` answers as given; every other command succeeds quietly.
function world(on: On, hasIndra: boolean) {
  on('fs.stat', () => ({ value: STAT }) as never)
  on('tool.call', () => ({ result: 'pages' }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('command.run', () => ({ text: '' }))
  on('settings.read', () => ({ value: {} }) as never)
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    const ok = argv === 'which indra-ocr' ? hasIndra : true
    return { value: { exitCode: ok ? 0 : 1, stdout: argv.includes('plugin list') ? '[]' : '', stderr: '' } } as never
  })
}

test('a long PDF is pointed to Indra once when it is installed; a few pages pass', async ($, on) => {
  world(on, true)
  const read = (_: unknown, pages?: string) => $.tool.call({ tool: 'Read', file_path: '/d/report.pdf', pages })
  await $.command.run({ command: 'van-code', args: '' } as never) // runs the equipment check
  expect((await read($, '2-3')).deny).toBeUndefined()
  expect((await read($, '10-12')).deny).toBeUndefined() // other pages: not a repeat read
  expect((await read($)).deny).toContain('indra-ocr')
  expect((await read($)).deny).toBeUndefined() // insisting goes through
})

test('without Indra a PDF is read as before', async ($, on) => {
  world(on, false)
  const read = (_: unknown) => $.tool.call({ tool: 'Read', file_path: '/d/report.pdf' })
  await $.command.run({ command: 'van-code', args: '' } as never)
  expect((await read($)).deny).toBeUndefined()
})
