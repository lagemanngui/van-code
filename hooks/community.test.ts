import { expect, test } from 'claude-code/testing'

import { communityText, findCommunity, termFor } from './community.js'
import type { Finding } from './official.js'
import type { Owner } from './scan.js'

const owner = (org: string, deps: string[], score = 2): Owner => ({ key: `github.com/${org}`, host: 'github.com', org, deps, repos: [], homepages: [], score })

test('the search term is the shared npm scope, else the main package', () => {
  expect(termFor(owner('adonisjs', ['@adonisjs/core', '@adonisjs/lucid']))).toBe('adonisjs')
  expect(termFor(owner('aio-libs', ['aiohttp', 'yarl']))).toBe('aiohttp')
  expect(termFor(owner('baseflow', ['flutter_cache_manager']))).toBe('flutter-cache-manager')
})

test('only uncovered owners are asked; fuzzy, unused, generic and already-official results are dropped', async () => {
  const asked: string[] = []
  const fetchJson = async (url: string) => {
    asked.push(url)
    const q = new URL(url).searchParams.get('q')
    if (q === 'adonisjs')
      return {
        skills: [
          { name: 'adonisjs', source: 'filipebraida/skills', skillId: 'adonisjs', installs: 81 },
          { name: 'adonisjs-best-practices', source: 'futuregerald/futuregerald-claude-plugin', skillId: 'adonisjs-best-practices', installs: 216 },
          { name: 'adonisjs-tiny', source: 'x/y', skillId: 'adonisjs-tiny', installs: 2 }, // nobody uses it
          { name: 'IP Geolocator', source: 'a/b', skillId: 'ip-geo', installs: 500 }, // fuzzy neighbour
          { name: 'adonisjs-from-flutter', source: 'flutter/agent-plugins', skillId: 'z', installs: 900 }, // shown as official
          { broken: true },
          null,
          1,
        ],
      }
    return { skills: null }
  }
  const owners = [owner('adonisjs', ['@adonisjs/core']), owner('nestjs', ['@nestjs/core']), owner('dart-lang', ['http']), owner('flutter', ['flutter_lints'])]
  const official: Finding[] = [
    { owner: 'github.com/nestjs', kind: 'plugin', title: 'nestjs', url: 'https://github.com/nestjs/agent-skills' },
    { owner: 'github.com/flutter', kind: 'plugin', title: 'dart-flutter', url: 'https://github.com/flutter/agent-plugins' },
  ]
  const found = await findCommunity(fetchJson, owners, official)
  expect(asked.length).toBe(1) // nest and flutter are covered, "http" is too generic to ask
  expect(found.map(f => `${f.source} ${f.installs}`)).toEqual(['futuregerald/futuregerald-claude-plugin 216', 'filipebraida/skills 81'])
  expect(found[0]!.install).toEqual(['npx skills add futuregerald/futuregerald-claude-plugin --skill adonisjs-best-practices -a claude-code -y'])
  expect(communityText(owners, found)).toContain('[community] adonisjs-best-practices by futuregerald, 216 installs: review it before installing')
  expect(await findCommunity(async () => { throw new Error('offline') }, [owner('adonisjs', ['@adonisjs/core'])], [])).toEqual([])
})
