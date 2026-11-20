import { expect, test } from 'claude-code/testing'

import { commandKey, errorLine, nextStreak } from './loops.js'

test('variants of one command share a key', () => {
  expect(commandKey('pnpm test')).toBe('pnpm test')
  expect(commandKey('DATABASE_URL=test pnpm test --filter api')).toBe('pnpm test')
  expect(commandKey('cd api && rtk bypass npx vitest run x.test.ts')).toBe('vitest run')
  expect(commandKey('docker compose up db')).toBe('docker compose')
  expect(commandKey('npm install')).not.toBe(commandKey('npm test'))
})

test('the error line skips noise and ignores numbers', () => {
  expect(errorLine('> api@1.0 test\n\nError: connect ECONNREFUSED 127.0.0.1:5432\n    at x')).toBe('Error: connect ECONNREFUSED 127.0.0.1:5432')
  expect(errorLine('')).toBe('')
})

test('a streak goes on through related failures and restarts on an unrelated one', () => {
  const a = (command: string, error: string) => ({ command, key: commandKey(command), error })
  let s = nextStreak([], a('pnpm test', 'Missing DATABASE_URL'))
  s = nextStreak(s, a('DATABASE_URL=x pnpm test', 'ECONNREFUSED 127.0.0.1:5432'))
  s = nextStreak(s, a('docker compose up db', 'ECONNREFUSED 127.0.0.1:5433')) // other tool, same error
  expect(s.length).toBe(3)
  expect(nextStreak(s, a('ls nope', 'No such file')).length).toBe(1)
})
