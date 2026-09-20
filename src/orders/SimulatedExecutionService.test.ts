import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrderStore } from './OrderStore'
import { SimulatedExecutionService } from './SimulatedExecutionService'
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

describe('SimulatedExecutionService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
  })
  afterEach(() => vi.useRealTimers())

  function createHarness(random = () => 0.9) {
    const store = new OrderStore()
    const service = new SimulatedExecutionService({
      store,
      acknowledgementDelayMs: 50,
      completionDelayMs: 100,
      venueRejectionProbability: 0.2,
      random,
      now: () => Date.now(),
      createExecutionOrderId: () => 'execution-order-1',
    })
    return { service, store }
  }

  it('publishes pending, acknowledged and filled states over time', () => {
    const { service, store } = createHarness()
    service.submit(request)
    expect(store.getOrder(request.clientOrderId)?.status).toBe('pending')

    vi.advanceTimersByTime(50)
    expect(store.getOrder(request.clientOrderId)).toMatchObject({
      status: 'acknowledged',
      executionOrderId: 'execution-order-1',
    })

    vi.advanceTimersByTime(100)
    expect(store.getOrder(request.clientOrderId)).toMatchObject({
      status: 'filled',
      fillPrice: request.quote.price,
      filledQuantityInBaseCurrency: request.quantityInBaseCurrency,
    })
  })

  it('can simulate a post-acknowledgement venue rejection', () => {
    const { service, store } = createHarness(() => 0.1)
    service.submit(request)
    vi.advanceTimersByTime(150)

    expect(store.getOrder(request.clientOrderId)).toMatchObject({
      status: 'rejected',
      rejectionStage: 'post_acknowledgement',
      rejectionReason: 'venue_rejected',
    })
  })

  it('cancels outstanding work when disposed', () => {
    const { service, store } = createHarness()
    service.submit(request)
    service.dispose()
    vi.runAllTimers()

    expect(store.getOrder(request.clientOrderId)?.status).toBe('pending')
    expect(() => service.submit({ ...request, clientOrderId: 'another' })).toThrow(
      'disposed',
    )
  })

  it('rejects invalid timing and probability configuration', () => {
    const store = new OrderStore()
    expect(
      () => new SimulatedExecutionService({ store, acknowledgementDelayMs: -1 }),
    ).toThrow(RangeError)
    expect(
      () => new SimulatedExecutionService({ store, venueRejectionProbability: 2 }),
    ).toThrow(RangeError)
  })
})
