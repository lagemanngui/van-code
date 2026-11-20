import { expect, test } from 'claude-code/testing'

import { judgeGit } from './git.js'

const kind = (cmd: string) => judgeGit(cmd)?.kind

test('commands that lose work are sorted into discards and force pushes', () => {
  expect(kind('git reset --hard HEAD~1')).toBe('discard')
  expect(kind('cd api && git checkout -- src/a.ts')).toBe('discard')
  expect(kind('git checkout .')).toBe('discard')
  expect(kind('git restore src/a.ts')).toBe('discard')
  expect(kind('git clean -fd')).toBe('discard')
  expect(kind('git stash drop')).toBe('discard')
  expect(judgeGit('git -C ../web reset --hard')?.dir).toBe('../web')
  expect(kind('git push --force origin main')).toBe('force')
  expect(kind('git push origin +main')).toBe('force')
})

test('safe git commands pass', () => {
  expect(kind('git checkout main')).toBeUndefined()
  expect(kind('git checkout -b feat')).toBeUndefined()
  expect(kind('git restore --staged a.ts')).toBeUndefined()
  expect(kind('git clean -n')).toBeUndefined()
  expect(kind('git reset HEAD a.ts')).toBeUndefined()
  expect(kind('git push --force-with-lease')).toBeUndefined()
  expect(kind('git stash pop')).toBeUndefined()
  expect(kind('git commit -m "git reset --hard"')).toBeUndefined()
})
