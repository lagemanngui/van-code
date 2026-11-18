import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listOrders } from '../src/orders.js'
import { paginate } from '../src/paginate.js'

test('partial last page is kept', () => {
  const p = paginate([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)
  assert.equal(p.totalPages, 4)
  assert.deepEqual(p.page(4), [10])
})

test('23 orders, 10 per page', () => {
  assert.equal(listOrders(1).totalPages, 3)
  assert.equal(listOrders(3).items.length, 3)
})

test('empty list and pages past the end', () => {
  const p = paginate([], 5)
  assert.equal(p.totalPages, 0)
  assert.deepEqual(p.page(1), [])
  assert.deepEqual(paginate([1, 2], 5).page(9), [])
})

test('even split still works', () => {
  assert.deepEqual(paginate([1, 2, 3, 4], 2).page(2), [3, 4])
})
