import { expect, test } from 'claude-code/testing'

import { changedRoots, isStale, manifestHashes, scanView } from './stack.js'

const owner = (org: string) => ({ key: `github.com/${org}`, host: 'github.com', org, deps: [org], repos: [], homepages: [], score: 2 })

test('the scan reads as a numbered install list plus one line each for docs, MCP and the rest', () => {
  const owners = [owner('nestjs'), owner('adonisjs'), owner('pydantic'), owner('baseflow')]
  const { text, items } = scanView(
    owners,
    [
      { owner: 'github.com/pydantic', kind: 'catalog', title: 'x', url: 'https://github.com/pydantic/skills', install: ['claude plugin install pydantic-ai@claude-plugins-official'] },
      { owner: 'github.com/nestjs', kind: 'plugin', title: 'x', url: 'https://github.com/nestjs/agent-skills', install: ['claude plugin marketplace add nestjs/agent-skills', 'claude plugin install nestjs@nestjs'] },
      { owner: 'github.com/nestjs', kind: 'llms', title: 'x', url: 'https://docs.nestjs.com/llms.txt' },
      { owner: 'github.com/pydantic', kind: 'mcp', title: 'x', url: 'https://github.com/pydantic/logfire-mcp' },
    ],
    [{ owner: 'github.com/adonisjs', term: 'adonisjs', name: 'adonisjs', source: 'a/b', skillId: 'adonisjs', installs: 81, url: 'https://skills.sh/a/b/adonisjs', install: ['npx skills add a/b --skill adonisjs -a claude-code -y'] }],
  )
  expect(items.map(i => i.name)).toEqual(['nestjs@nestjs', 'pydantic-ai@claude-plugins-official', 'a/b adonisjs']) // heaviest owner first
  expect(text).toContain('  1  nestjs    nestjs@nestjs')
  expect(text).toContain('Docs for agents (llms.txt): docs.nestjs.com/llms.txt')
  expect(text).toContain('MCP repos to look at: pydantic/logfire-mcp')
  expect(text).toContain('Nothing found for: baseflow')
  expect(text).not.toContain('$ ')
})

test('the cache sees a changed manifest, a new repo and age; nothing else', async () => {
  const files: Record<string, string> = { '/w/api/package.json': '{"dependencies":{"@nestjs/core":"12"}}', '/w/web/pubspec.yaml': 'name: web' }
  const read = async (p: string) => {
    if (p in files) return files[p]!
    throw new Error('ENOENT')
  }
  const before = await manifestHashes(read, ['/w', '/w/api', '/w/web'])
  expect(Object.values(before).every(h => /^[0-9a-f]{40}$/.test(h))).toBe(true)
  expect(changedRoots(before, await manifestHashes(read, ['/w', '/w/api', '/w/web']))).toEqual([])
  files['/w/api/package.json'] = '{"dependencies":{"@nestjs/core":"12","@adonisjs/core":"7"}}'
  files['/w/new/go.mod'] = 'module x'
  expect(changedRoots(before, await manifestHashes(read, ['/w', '/w/api', '/w/web', '/w/new']))).toEqual(['/w/api', '/w/new'])
  const cache = { hashes: before, text: '', items: [], at: 0 }
  expect(isStale(cache, 6 * 24 * 3600_000)).toBe(false)
  expect(isStale(cache, 8 * 24 * 3600_000)).toBe(true)
})
