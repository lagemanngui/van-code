import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { getCart } from '../src/api/handlers.js'
import { cartTotal, discount, subtotal } from '../src/cart.js'
import { ordersCsv } from '../src/export/csv.js'

// the latest rate of each currency, from the file itself
const latest = {}
for (const r of JSON.parse(readFileSync(new URL('../data/rates.json', import.meta.url))).rates)
  if (!latest[r.currency] || r.date > latest[r.currency].date) latest[r.currency] = r
const rate = c => (c === 'USD' ? 1 : latest[c].perUSD)
const cart = [{ id: 'books-001', qty: 3 }, { id: 'tea-015', qty: 2 }, { id: 'bikes-007', qty: 1 }]
const usd = subtotal(cart) - discount(subtotal(cart))
const inC = c => Math.round(usd * rate(c))

test('hidden: the discount starts at exactly $100', () => {
  assert.equal(discount(10000), 1000)
})

test('hidden: cartTotal converts with the latest rate of each currency', () => {
  assert.equal(cartTotal(cart), usd)
  assert.equal(cartTotal(cart, 'USD'), usd)
  for (const c of ['EUR', 'BRL', 'JPY', 'GBP']) assert.equal(cartTotal(cart, c), inC(c), c)
})

test('hidden: the CSV has a currency column and totals in it', () => {
  const lines = ordersCsv([
    { id: 'o1', customer: 'ana', cart },
    { id: 'o2', customer: 'bea', cart, currency: 'BRL' },
  ]).split('\n')
  assert.equal(lines[0], 'id,customer,currency,total')
  assert.equal(lines[1], `o1,ana,USD,${(usd / 100).toFixed(2)}`)
  assert.equal(lines[2], `o2,bea,BRL,${(inC('BRL') / 100).toFixed(2)}`)
})

test('hidden: GET /cart takes ?currency and refuses an unknown one', () => {
  assert.deepEqual(getCart(new URLSearchParams('currency=EUR'), cart), { status: 200, body: { total: inC('EUR'), currency: 'EUR' } })
  assert.deepEqual(getCart(new URLSearchParams(''), cart), { status: 200, body: { total: usd, currency: 'USD' } })
  assert.deepEqual(getCart(new URLSearchParams('currency=XYZ'), cart), { status: 400, body: { error: 'unknown currency' } })
})
