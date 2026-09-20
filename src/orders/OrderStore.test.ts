import { describe, expect, it, vi } from 'vitest'
import { OrderStore } from './OrderStore'
import type { OrderRequest } from './types'

const request: OrderRequest = {
  clientOrderId: 'client-order-1',
  instrument: 'EUR/USD',
  venue: 'CITI',
  side: 'buy',
  quantityInBaseCurrency: 1_000_000,
  quote: {
    streamId: 'stream-1',
    sequence: 42,
    receivedAt: 900,
    price: 1.0848,
  },
  submittedAt: 1_000,
}

describe('OrderStore', () => {
  it('publishes each lifecycle transition immediately', () => {
    const store = new OrderStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.add(request)
    store.apply({
      type: 'order_acknowledged',
      clientOrderId: request.clientOrderId,
      executionOrderId: 'execution-order-1',
      occurredAt: 1_010,
    })

    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot()).toMatchObject({ version: 2 })
    expect(store.getSnapshot().changedOrders[0].status).toBe('acknowledged')
  })

  it('keeps newest orders first without reordering them on updates', () => {
    const store = new OrderStore()
    store.add(request)
    store.add({ ...request, clientOrderId: 'client-order-2', submittedAt: 2_000 })
    store.apply({
      type: 'order_acknowledged',
      clientOrderId: request.clientOrderId,
      executionOrderId: 'execution-order-1',
      occurredAt: 2_010,
    })

    expect(store.getSnapshot().orders.map((order) => order.clientOrderId)).toEqual([
      'client-order-2',
      'client-order-1',
    ])
  })

  it('rejects duplicate and unknown order IDs', () => {
    const store = new OrderStore()
    store.add(request)

    expect(() => store.add(request)).toThrow('already exists')
    expect(() =>
      store.apply({
        type: 'order_acknowledged',
        clientOrderId: 'unknown-order',
        executionOrderId: 'execution-order-1',
        occurredAt: 1_010,
      }),
    ).toThrow('does not exist')
  })
})
