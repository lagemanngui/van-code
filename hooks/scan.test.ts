import { expect, test } from 'claude-code/testing'

import { discover, normalizeRepo } from './scan.js'

test('every repository spelling becomes https://host/org/repo', () => {
  expect(normalizeRepo('git+https://github.com/nestjs/nest.git')).toBe('https://github.com/nestjs/nest')
  expect(normalizeRepo({ type: 'git', url: 'https://github.com/vercel/next.js.git', directory: 'packages/next' })).toBe('https://github.com/vercel/next.js')
  expect(normalizeRepo('git@github.com:adonisjs/core.git')).toBe('https://github.com/adonisjs/core')
  expect(normalizeRepo('github:facebook/react')).toBe('https://github.com/facebook/react')
  expect(normalizeRepo('sindresorhus/globals')).toBe('https://github.com/sindresorhus/globals')
  expect(normalizeRepo('https://gitlab.com/group/proj/-/tree/main')).toBe('https://gitlab.com/group/proj')
  expect(normalizeRepo('https://example.com/docs')).toBeUndefined()
  expect(normalizeRepo(undefined)).toBeUndefined()
})

test('dependencies are grouped by the owner of their repository, biggest first', async () => {
  const files: Record<string, string> = {
    '/r/package.json': JSON.stringify({ dependencies: { '@nestjs/core': '12', '@nestjs/common': '12', zod: '4' }, devDependencies: { vitest: '3' } }),
    '/r/node_modules/@nestjs/core/package.json': JSON.stringify({ repository: { url: 'git+https://github.com/nestjs/nest.git' }, homepage: 'https://nestjs.com' }),
    '/r/node_modules/@nestjs/common/package.json': JSON.stringify({ repository: 'https://github.com/nestjs/nest' }),
    '/r/node_modules/zod/package.json': JSON.stringify({ repository: 'github:colinhacks/zod' }),
    // vitest not installed: unresolved
    '/r/go.mod': 'module x\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.10.0\n\tgolang.org/x/sys v0.1.0 // indirect\n)\n',
    '/r/requirements.txt': 'fastapi>=0.110\n# comment\n',
    '/r/.venv/lib/python3.12/site-packages/fastapi-0.115.0.dist-info/METADATA':
      'Name: fastapi\nProject-URL: Documentation, https://fastapi.tiangolo.com\nProject-URL: Repository, https://github.com/fastapi/fastapi\n',
    '/r/composer.json': JSON.stringify({ require: { php: '^8.3', 'laravel/framework': '^12' } }),
    '/r/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'laravel/framework', source: { url: 'https://github.com/laravel/framework.git' }, homepage: 'https://laravel.com' }] }),
  }
  const dirs: Record<string, string[]> = {
    '/r/.venv/lib': ['python3.12'],
    '/r/.venv/lib/python3.12/site-packages': ['fastapi-0.115.0.dist-info'],
  }
  const io = {
    read: async (p: string) => {
      if (p in files) return files[p]!
      throw new Error('ENOENT')
    },
    list: async (p: string) => {
      if (p in dirs) return dirs[p]!.map(name => ({ name, kind: 'dir' }))
      throw new Error('ENOENT')
    },
  }
  const found = await discover(io, '/r')
  expect(found.owners.map(o => `${o.key} ${o.score}`)).toEqual([
    'github.com/nestjs 4',
    'github.com/colinhacks 2',
    'github.com/fastapi 2',
    'github.com/gin-gonic 2',
    'github.com/laravel 2',
  ])
  expect(found.owners[0]!.repos).toEqual(['nest'])
  expect(found.owners[0]!.homepages).toEqual(['https://nestjs.com'])
  expect(found.unresolved).toEqual(['vitest'])
  expect(found.deps.some(d => d.name === 'golang.org/x/sys')).toBe(false) // indirect
  expect(found.deps.some(d => d.name === 'php')).toBe(false)
})

const memIo = (files: Record<string, string>, dirs: Record<string, string[]> = {}) => ({
  read: async (p: string) => {
    if (p in files) return files[p]!
    throw new Error('ENOENT')
  },
  list: async (p: string) => {
    if (p in dirs) return dirs[p]!.map(name => ({ name, kind: 'dir' }))
    throw new Error('ENOENT')
  },
})

test('pyproject extras do not cut the dependency list', async () => {
  const io = memIo({ '/r/pyproject.toml': '[project]\ndependencies = [\n  "uvicorn[standard]>=0.30",  # server\n  "fastapi>=0.110",\n]\n' })
  expect((await discover(io, '/r')).deps.map(d => d.name)).toEqual(['uvicorn', 'fastapi'])
})

test('runtime packages outrank tooling, and @types stubs are left out', async () => {
  const io = memIo({
    '/r/package.json': JSON.stringify({ dependencies: { next: '16' }, devDependencies: { eslint: '9', '@eslint/js': '9', '@types/react': '19' } }),
    '/r/node_modules/next/package.json': JSON.stringify({ repository: { url: 'https://github.com/vercel/next.js' } }),
    '/r/node_modules/eslint/package.json': JSON.stringify({ repository: 'eslint/eslint' }),
    '/r/node_modules/@eslint/js/package.json': JSON.stringify({ repository: 'eslint/eslint' }),
    '/r/node_modules/@types/react/package.json': JSON.stringify({ repository: 'https://github.com/DefinitelyTyped/DefinitelyTyped' }),
  })
  const found = await discover(io, '/r')
  // next alone (2) ties two dev tools (1 + 1); the org name breaks the tie, @types is gone
  expect(found.owners.map(o => o.org)).toEqual(['eslint', 'vercel'])
  expect(found.owners.find(o => o.org === 'vercel')!.repos).toEqual(['next.js'])
  expect(found.owners.some(o => o.org === 'definitelytyped')).toBe(false)
})

test('Dart: pubspec dependencies resolve through pubspec.lock and ~/.pub-cache, SDKs skipped', async () => {
  const io = {
    ...memIo({
      '/r/pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  provider: ^6.1.0\n  http: ^1.2.0\n\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n',
      '/r/pubspec.lock': 'packages:\n  http:\n    dependency: "direct main"\n    version: "1.2.2"\n  provider:\n    dependency: "direct main"\n    version: "6.1.2"\n',
      '/h/.pub-cache/hosted/pub.dev/provider-6.1.2/pubspec.yaml': 'name: provider\nrepository: https://github.com/rrousselGit/provider\n',
      '/h/.pub-cache/hosted/pub.dev/http-1.2.2/pubspec.yaml': 'name: http\nrepository: https://github.com/dart-lang/http/tree/master/pkgs/http\n',
    }),
    home: '/h',
  }
  const found = await discover(io, '/r')
  expect(found.deps.map(d => d.name)).toEqual(['provider', 'http'])
  expect(found.owners.map(o => o.key).sort()).toEqual(['github.com/dart-lang', 'github.com/rrousselgit'])
})

test('a package nothing installed knows is asked of its registry, when the network is allowed', async () => {
  const files = { '/r/package.json': JSON.stringify({ dependencies: { '@adonisjs/core': '7' } }) }
  const asked: string[] = []
  const offline = await discover(memIo(files), '/r')
  expect(offline.unresolved).toEqual(['@adonisjs/core'])
  const online = await discover(
    {
      ...memIo(files),
      fetchJson: async url => {
        asked.push(url)
        return { repository: { url: 'git+https://github.com/adonisjs/core.git' }, homepage: 'https://adonisjs.com' }
      },
    },
    '/r',
  )
  expect(asked).toEqual(['https://registry.npmjs.org/@adonisjs%2Fcore/latest'])
  expect(online.owners.map(o => o.key)).toEqual(['github.com/adonisjs'])
  expect(online.owners[0]!.homepages).toEqual(['https://adonisjs.com'])
})
