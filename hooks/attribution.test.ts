import { expect, test } from 'claude-code/testing'

import { findAttribution } from './attribution.js'

test('AI attribution in commits and PRs is found', () => {
  expect(findAttribution(`git commit -m "$(cat <<'EOF'\nFix\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nEOF\n)"`)).toBe(
    'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
  )
  expect(findAttribution('gh pr create --body "x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"')).toBe(
    'Generated with [Claude Code](https://claude.com/claude-code)',
  )
  expect(findAttribution('git commit -m "x" -m "Co-authored-by: GitHub Copilot <x@y>"')).toBe('Co-authored-by: GitHub Copilot <x@y>')
  expect(findAttribution('git commit -m "x" --trailer "Co-authored-by: Ana <ana@x.com>"')).toBeUndefined()
  expect(findAttribution('git commit -m "Add Claude API client"')).toBeUndefined()
  expect(findAttribution('git log --grep "Co-Authored-By: Claude"')).toBeUndefined()
})
