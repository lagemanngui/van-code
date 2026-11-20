import type { Owner } from './scan.js'
import { expect, test } from 'claude-code/testing'

import { findOfficial, officialText, pickOwners } from './official.js'

const owner = (org: string, repos: string[], deps: string[], score: number, homepages: string[] = []): Owner => ({
  key: `github.com/${org}`,
  host: 'github.com',
  org,
  repos,
  deps,
  homepages,
  score,
})

test('owners from several repos merge, heaviest first', () => {
  const merged = pickOwners([[owner('nestjs', ['nest'], ['@nestjs/core'], 4)], [owner('nestjs', ['nest'], ['@nestjs/common'], 2), owner('zod', ['zod'], ['zod'], 2)]])
  expect(merged.map(o => `${o.org} ${o.score}`)).toEqual(['nestjs 6', 'zod 2'])
  expect(merged[0]!.deps).toEqual(['@nestjs/core', '@nestjs/common'])
})

test('official resources: catalog, marketplaces, skills and llms.txt, filtered to what the project uses', async () => {
  const owners = [
    owner('nestjs', ['nest'], ['@nestjs/core'], 4, ['https://nestjs.com']),
    owner('aio-libs', ['aiohttp'], ['aiohttp'], 2),
    owner('pydantic', ['pydantic'], ['pydantic'], 2),
  ]
  const asked: string[] = []
  const code: Record<string, { repository: { full_name: string }; path: string }[]> = {
    marketplace: [
      { repository: { full_name: 'nestjs/agent-skills' }, path: '.claude-plugin/marketplace.json' },
      { repository: { full_name: 'aio-libs/aiobotocore' }, path: '.claude-plugin/marketplace.json' }, // the maintainers' bot
    ],
    skill: [
      { repository: { full_name: 'nestjs/agent-skills' }, path: 'skills/nestjs/SKILL.md' }, // covered by its marketplace
      { repository: { full_name: 'nestjs/typescript-starter' }, path: '.claude/skills/nestjs/SKILL.md' }, // a copy
    ],
  }
  const raw: Record<string, string> = {
    'https://raw.githubusercontent.com/nestjs/agent-skills/HEAD/.claude-plugin/marketplace.json': JSON.stringify({ name: 'nestjs', plugins: [{ name: 'nestjs' }] }),
    'https://raw.githubusercontent.com/aio-libs/aiobotocore/HEAD/.claude-plugin/marketplace.json': JSON.stringify({ name: 'aiobotocore', plugins: [{ name: 'aiobotocore-bot' }] }),
    'https://nestjs.com/llms.txt': '# NestJS\n\n> docs',
    'https://docs.nestjs.com/llms.txt': '<html>not found</html>',
  }
  const found = await findOfficial(
    {
      catalogName: 'claude-plugins-official',
      catalog: [
        { name: 'pydantic-ai', source: { url: 'https://github.com/pydantic/skills.git' } },
        { name: 'logfire', source: { url: 'https://github.com/pydantic/skills.git' } }, // the owner's, but not this project's
      ],
      gh: async (path, params = {}) => {
        asked.push(`${path} ${params.q}`)
        if (path === 'search/code') return { items: params.q!.includes('marketplace') ? code.marketplace : code.skill }
        return { items: [{ full_name: 'nestjs/mcp', html_url: 'https://github.com/nestjs/mcp', description: 'An MCP module' }] }
      },
      fetchText: async url => (url in raw ? { ok: true, text: raw[url]! } : { ok: false, text: '' }),
    },
    owners,
  )
  const text = officialText(owners, found)
  expect(text).toContain('$ claude plugin marketplace add nestjs/agent-skills')
  expect(text).toContain('$ claude plugin install nestjs@nestjs')
  expect(text).toContain('[official docs] llms.txt: NestJS')
  expect(text).toContain('$ claude plugin install pydantic-ai@claude-plugins-official')
  expect(text).toContain('[see also] nestjs/mcp')
  expect(text).not.toContain('aiobotocore')
  expect(text).not.toContain('logfire')
  expect(text).not.toContain('typescript-starter')
  expect(text).toContain('github.com/aio-libs (aiohttp)\n  nothing official found')
  // all three orgs fit one query per kind: three searches in all
  expect(asked.length).toBe(3)
  expect(asked[0]).toContain('org:nestjs org:aio-libs org:pydantic')
})

test('a malformed marketplace.json is skipped, not fatal', async () => {
  const owners = [owner('acme', ['acme-skills'], ['acme'], 2)]
  for (const text of ['null', '{"name":"x","plugins":"abc"}', '{"name":"x","plugins":{}}', '{"name":5,"plugins":[{"name":3},null]}', 'not json']) {
    const found = await findOfficial(
      {
        catalogName: 'c',
        catalog: [],
        gh: async (path, params = {}) =>
          path === 'search/code' && params.q!.includes('marketplace') ? { items: [{ repository: { full_name: 'acme/acme-skills' }, path: '.claude-plugin/marketplace.json' }] } : { items: [] },
        fetchText: async url => (url.includes('raw.githubusercontent') ? { ok: true, text } : { ok: false, text: '' }),
      },
      owners,
    )
    // still listed (a collection repo), with the marketplace add only
    expect(found.map(f => f.install?.join(' | '))).toEqual(['claude plugin marketplace add acme/acme-skills'])
  }
})
