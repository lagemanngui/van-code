import { expect, test } from 'claude-code/testing'

import { errorSig } from './register.js'

test('error positions do not change the signature, the message does', () => {
  expect(errorSig('x.py:3:5: F821 undefined name y')).toBe(errorSig('x.py:7:1: F821 undefined name y'))
  expect(errorSig('a.ts(10,3): error TS2345: bad arg')).toBe(errorSig('a.ts(12,9): error TS2345: bad arg'))
  expect(errorSig('x.sh: line 3: syntax error')).toBe(errorSig('x.sh: line 8: syntax error'))
  expect(errorSig('x.py:3:5: F821 undefined name y')).not.toBe(errorSig('x.py:3:5: F821 undefined name z'))
})

test('the same checker error after two edits says to fix it at its source', async ($, on) => {
  let err = 'x.sh: line 3: syntax error near `fi`'
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }) as never)
  on('process.run', (_, e) => {
    const isBashN = e.argv[0] === 'bash'
    return { value: { exitCode: isBashN && err ? 2 : 1, stdout: '', stderr: isBashN ? err : '' } } as never
  })
  on('tool.call', () => ({ result: {} }))
  on('ui.toast', () => ({ value: undefined }) as never)
  const edit = async () =>
    ((await $.tool.call({ tool: 'Edit', file_path: '/p/x.sh', old_string: 'a', new_string: 'b' } as never)).context ?? []).join('\n')

  expect(await edit()).not.toContain('stop patching')
  expect(await edit()).toContain('same error after 2 edits')
  err = 'x.sh: line 9: unexpected EOF' // a different error starts over
  expect(await edit()).not.toContain('stop patching')
})
