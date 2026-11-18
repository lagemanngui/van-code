# Fixture: a small order API whose pagination drops the last partial page.
import sys
from pathlib import Path

root = Path(sys.argv[1])
files = {
    'package.json': '{\n  "name": "orders-api",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
    'src/paginate.js': '''// Splits items into pages of `size`; pages are numbered from 1.
export function paginate(items, size) {
  const totalPages = Math.floor(items.length / size)
  return {
    totalPages,
    page(n) {
      if (n < 1 || n > totalPages) throw new RangeError(`no page ${n}`)
      return items.slice((n - 1) * size, n * size)
    },
  }
}
''',
    'src/orders.js': '''import { paginate } from './paginate.js'

const ORDERS = Array.from({ length: 23 }, (_, i) => ({ id: 1000 + i, total: (i * 7) % 50 }))

export function listOrders(page, size = 10) {
  const p = paginate(ORDERS, size)
  return { totalPages: p.totalPages, items: p.page(page) }
}
''',
    'test/paginate.test.js': '''import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paginate } from '../src/paginate.js'

test('even split', () => {
  const p = paginate([1, 2, 3, 4], 2)
  assert.equal(p.totalPages, 2)
  assert.deepEqual(p.page(2), [3, 4])
})
''',
    'README.md': '# orders-api\n\n`npm test` runs the tests (node:test, no dependencies).\n',
}
for name, text in files.items():
    (root / name).parent.mkdir(parents=True, exist_ok=True)
    (root / name).write_text(text)
