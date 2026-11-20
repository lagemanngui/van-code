import { expect, test } from 'claude-code/testing'

import { detectProjects, hasWeb, infra, langs, roots, setCwd } from './factory.js'

test('a folder of side-by-side repos: languages and infra are found one level down', async () => {
  setCwd('/w') // not a repo itself: api/ and web/ are; docs/ is a plain folder
  const ran: string[] = []
  const $ = {
    fs: {
      list: async () => [
        { name: 'api', kind: 'dir', size: 0 },
        { name: 'web', kind: 'dir', size: 0 },
        { name: 'docs', kind: 'dir', size: 0 },
        { name: '.cache', kind: 'dir', size: 0 },
        { name: 'notes.md', kind: 'file', size: 1 },
      ],
      read: async (p: string) => (p === '/w/web/package.json' ? '{"dependencies": {"react": "^19"}}' : Promise.reject(new Error('ENOENT'))),
      exists: async (p: string) => ['/w/api/.git', '/w/web/.git'].includes(p),
      stat: async (p: string) => {
        if (p === '/w/api/go.mod') return { kind: 'file', size: 1, mtimeMs: 1, isLink: false }
        throw new Error('ENOENT')
      },
    },
    process: {
      run: async (argv: string[]) => {
        const line = argv.join(' ')
        ran.push(line)
        const out = line === 'git -C /w/web ls-files -- *Chart.yaml' ? 'chart/Chart.yaml\n' : ''
        return { exitCode: out ? 0 : 1, stdout: out, stderr: '' }
      },
    },
  }

  // a bare engine: detection only lists, stats and runs git
  await detectProjects($ as never)
  expect(roots).toEqual(['/w', '/w/api', '/w/web'])
  expect(langs.map(l => l.name)).toEqual(['Go']) // go.mod in /w/api
  expect(infra.map(i => i.name)).toEqual(['Helm']) // Chart.yaml in /w/web
  expect(hasWeb).toBe(true) // react in /w/web
  expect(ran.some(a => a.includes('/w/docs'))).toBe(false)
})
