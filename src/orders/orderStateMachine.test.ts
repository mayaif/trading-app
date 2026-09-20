import { describe, expect, it } from 'vitest'
import { transitionOrder } from './orderStateMachine'
import type { AcknowledgedOrder, PendingOrder } from './types'

const pending: PendingOrder = {
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
  status: 'pending',
}

const acknowledged: AcknowledgedOrder = {
  ...pending,
  status: 'acknowledged',
  executionOrderId: 'execution-order-1',
  acknowledgedAt: 1_010,
}

describe('transitionOrder', () => {
  it('transitions pending to acknowledged and then filled', () => {
    const next = transitionOrder(pending, {
      type: 'order_acknowledged',
      clientOrderId: pending.clientOrderId,
      executionOrderId: 'execution-order-1',
      occurredAt: 1_010,
    })
    expect(next).toEqual(acknowledged)

    const filled = transitionOrder(next, {
      type: 'order_filled',
      clientOrderId: pending.clientOrderId,
      fillPrice: 1.08481,
      filledQuantityInBaseCurrency: 1_000_000,
      occurredAt: 1_020,
    })
    expect(filled).toMatchObject({
      status: 'filled',
      fillPrice: 1.08481,
      filledAt: 1_020,
    })
  })

  it('records whether rejection happened before or after acknowledgement', () => {
    const event = {
      type: 'order_rejected' as const,
      clientOrderId: pending.clientOrderId,
      reason: 'venue_rejected' as const,
      message: 'Simulated venue rejection.',
      occurredAt: 1_020,
    }

    expect(transitionOrder(pending, event)).toMatchObject({
      status: 'rejected',
      rejectionStage: 'pre_acknowledgement',
    })
    expect(transitionOrder(acknowledged, event)).toMatchObject({
      status: 'rejected',
      rejectionStage: 'post_acknowledgement',
      executionOrderId: 'execution-order-1',
    })
  })

  it('rejects impossible and terminal transitions', () => {
    expect(() =>
      transitionOrder(pending, {
        type: 'order_filled',
        clientOrderId: pending.clientOrderId,
        fillPrice: 1.08481,
        filledQuantityInBaseCurrency: 1_000_000,
        occurredAt: 1_020,
      }),
    ).toThrow('Cannot apply order_filled to a pending order')

    const rejected = transitionOrder(pending, {
      type: 'order_rejected',
      clientOrderId: pending.clientOrderId,
      reason: 'venue_rejected',
      message: 'Rejected.',
      occurredAt: 1_010,
    })
    expect(() =>
      transitionOrder(rejected, {
        type: 'order_acknowledged',
        clientOrderId: pending.clientOrderId,
        executionOrderId: 'too-late',
        occurredAt: 1_020,
      }),
    ).toThrow('terminal rejected order')
  })

  it('rejects events for a different order or with non-chronological time', () => {
    expect(() =>
      transitionOrder(pending, {
        type: 'order_acknowledged',
        clientOrderId: 'another-order',
        executionOrderId: 'execution-order-1',
        occurredAt: 1_010,
      }),
    ).toThrow('different order')

    expect(() =>
      transitionOrder(pending, {
        type: 'order_acknowledged',
        clientOrderId: pending.clientOrderId,
        executionOrderId: 'execution-order-1',
        occurredAt: 999,
      }),
    ).toThrow('chronological')
  })
})
