# Fixture: a small shop (20 catalog modules, cart, CSV export, API handler, ~30 files) and a 1.8 MB rates file.
# A multi-part feature, with traps: the latest rate differs per currency (BRL stops earlier), the rates are shuffled
# (the file's tail is not the latest), and a discount test already fails (`>` where the rule says "or more").
import datetime, json, math, random, sys
from pathlib import Path

root = Path(sys.argv[1])
files = {
    'package.json': '{\n  "name": "shop",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
    'README.md': '# shop\n\nCatalog, cart, CSV export and the HTTP handlers. `npm test` runs the tests. Prices are USD cents.\n',
}
CATS = ['books', 'games', 'garden', 'kitchen', 'music', 'office', 'outdoor', 'pets', 'shoes', 'sports',
        'tools', 'toys', 'travel', 'audio', 'bikes', 'camera', 'crafts', 'lamps', 'paper', 'tea']
rnd = random.Random(7)
for cat in CATS:
    items = ',\n'.join(f"  {{ id: '{cat}-{i:03}', name: '{cat.title()} item {i}', priceCents: {rnd.randrange(199, 25000)} }}" for i in range(1, 16))
    files[f'src/products/{cat}.js'] = f'// The {cat} catalog: prices in USD cents.\nexport default [\n{items},\n]\n'
files['src/catalog.js'] = (''.join(f"import {c} from './products/{c}.js'\n" for c in CATS) +
    f"\nexport const products = [{', '.join('...' + c for c in CATS)}]\nexport const byId = Object.fromEntries(products.map(p => [p.id, p]))\n")
files['src/cart.js'] = '''import { byId } from './catalog.js'

// A cart is [{ id, qty }]. Amounts are USD cents.
export function subtotal(cart) {
  return cart.reduce((sum, line) => sum + byId[line.id].priceCents * line.qty, 0)
}

// 10% off orders of $100 or more.
export function discount(cents) {
  return cents > 10000 ? Math.round(cents * 0.1) : 0
}

export function cartTotal(cart) {
  const s = subtotal(cart)
  return s - discount(s)
}
'''
files['src/export/csv.js'] = '''import { cartTotal } from '../cart.js'

// One line per order: id, customer, total in dollars with two decimals.
export function ordersCsv(orders) {
  return ['id,customer,total', ...orders.map(o => `${o.id},${o.customer},${(cartTotal(o.cart) / 100).toFixed(2)}`)].join('\\n')
}
'''
files['src/api/handlers.js'] = '''import { cartTotal } from '../cart.js'

// GET /cart. query is a URLSearchParams; the answer is { status, body }.
export function getCart(query, cart) {
  return { status: 200, body: { total: cartTotal(cart) } }
}
'''
files['test/catalog.test.js'] = '''import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byId, products } from '../src/catalog.js'

test('the catalog has 300 products with unique ids', () => {
  assert.equal(products.length, 300)
  assert.equal(Object.keys(byId).length, 300)
})
'''
files['test/cart.test.js'] = '''import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cartTotal, discount, subtotal } from '../src/cart.js'

test('subtotal adds price times quantity', () => {
  assert.equal(subtotal([{ id: 'books-001', qty: 2 }]), 2 * subtotal([{ id: 'books-001', qty: 1 }]))
})

test('10% off orders of $100 or more', () => {
  assert.equal(discount(9999), 0)
  assert.equal(discount(10000), 1000)
  assert.equal(discount(25000), 2500)
})

test('the total is the subtotal less the discount', () => {
  const cart = [{ id: 'books-001', qty: 3 }, { id: 'tea-015', qty: 1 }]
  assert.equal(cartTotal(cart), subtotal(cart) - discount(subtotal(cart)))
})
'''
files['test/csv.test.js'] = '''import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ordersCsv } from '../src/export/csv.js'

test('the CSV has a header and one line per order', () => {
  const lines = ordersCsv([{ id: 'o1', customer: 'ana', cart: [{ id: 'books-001', qty: 1 }] }]).split('\\n')
  assert.equal(lines[0], 'id,customer,total')
  assert.equal(lines.length, 2)
})
'''
files['test/handlers.test.js'] = '''import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getCart } from '../src/api/handlers.js'
import { cartTotal } from '../src/cart.js'

test('GET /cart answers the total', () => {
  const cart = [{ id: 'games-002', qty: 1 }]
  const r = getCart(new URLSearchParams(''), cart)
  assert.equal(r.status, 200)
  assert.equal(r.body.total, cartTotal(cart))
})
'''
for name, text in files.items():
    (root / name).parent.mkdir(parents=True, exist_ok=True)
    (root / name).write_text(text)

# rates: 30 currencies, daily for 3 years; BRL stops on 2025-11-15, JPY on 2025-12-20; shuffled
CUR = {'EUR': 0.92, 'BRL': 5.1, 'GBP': 0.79, 'JPY': 151.0, 'CAD': 1.36, 'AUD': 1.52, 'CHF': 0.88, 'CNY': 7.2, 'INR': 83.0, 'MXN': 17.1,
       'SEK': 10.4, 'NOK': 10.6, 'DKK': 6.9, 'PLN': 4.0, 'CZK': 23.0, 'HUF': 360.0, 'ZAR': 18.5, 'KRW': 1330.0, 'SGD': 1.35, 'NZD': 1.64,
       'TRY': 32.0, 'ARS': 870.0, 'CLP': 940.0, 'COP': 3900.0, 'PEN': 3.7, 'ILS': 3.7, 'THB': 36.0, 'PHP': 56.0, 'IDR': 15700.0, 'HKD': 7.8}
STOP = {'BRL': 1050, 'JPY': 1085}  # day index of the last rate
rows = []
for i, (c, base) in enumerate(CUR.items()):
    for day in range(STOP.get(c, 1095) + 1):
        date = (datetime.date(2023, 1, 1) + datetime.timedelta(days=day)).isoformat()
        rows.append({'date': date, 'currency': c, 'perUSD': round(base * (1 + 0.05 * math.sin(day / 40 + i)), 4)})
random.Random(11).shuffle(rows)
(root / 'data').mkdir(exist_ok=True)
(root / 'data' / 'rates.json').write_text(json.dumps({'base': 'USD', 'rates': rows}, indent=1))
