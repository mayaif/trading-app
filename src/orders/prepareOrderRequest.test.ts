import { describe, expect, it } from 'vitest'
import type { MarketDataRow } from '../market-data/MarketDataStore'
import { prepareOrderRequest } from './prepareOrderRequest'
import type { OrderDraft } from './types'

const quote: MarketDataRow = {
  key: 'EUR/USD:CITI',
  instrument: 'EUR/USD',
  venue: 'CITI',
  bidPrice: 1.08472,
  bidSize: 1_000_000,
  askPrice: 1.0848,
  askSize: 1_000_000,
  tradable: true,
  streamId: 'stream-1',
  sequence: 42,
  receivedAt: 9_500,
}

const draft: OrderDraft = {
  instrument: 'EUR/USD',
  venue: 'CITI',
  side: 'buy',
  quantityInBaseCurrency: 1_000_000,
}

function prepare(overrides: Partial<Parameters<typeof prepareOrderRequest>[0]> = {}) {
  return prepareOrderRequest({
    draft,
    quote,
    connectionStatus: 'live',
    now: 10_000,
    createClientOrderId: () => 'client-order-1',
    ...overrides,
  })
}

describe('prepareOrderRequest', () => {
  it('captures the ask and quote provenance for a buy', () => {
    const result = prepare()

    expect(result).toEqual({
      ok: true,
      request: {
        clientOrderId: 'client-order-1',
        instrument: 'EUR/USD',
        venue: 'CITI',
        side: 'buy',
        quantityInBaseCurrency: 1_000_000,
        quote: {
          streamId: 'stream-1',
          sequence: 42,
          receivedAt: 9_500,
          price: 1.0848,
        },
        submittedAt: 10_000,
      },
    })
  })

  it('captures the bid for a sell', () => {
    const result = prepare({ draft: { ...draft, side: 'sell' } })

    expect(result.ok && result.request.quote.price).toBe(1.08472)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid quantity %s',
    (quantityInBaseCurrency) => {
      const result = prepare({
        draft: { ...draft, quantityInBaseCurrency },
      })
      expect(result).toMatchObject({ ok: false, reason: 'invalid_quantity' })
    },
  )

  it('rejects submission when the market-data connection is not live', () => {
    expect(prepare({ connectionStatus: 'stale' })).toMatchObject({
      ok: false,
      reason: 'connection_not_live',
    })
  })

  it('rejects a stale quote using its local receipt time', () => {
    expect(prepare({ now: 11_001 })).toMatchObject({
      ok: false,
      reason: 'stale_quote',
    })
  })

  it('rejects a quote that the venue marked non-tradable', () => {
    expect(prepare({ quote: { ...quote, tradable: false } })).toMatchObject({
      ok: false,
      reason: 'quote_not_tradable',
    })
  })

  it('rejects a missing or mismatched selected quote', () => {
    expect(prepare({ quote: undefined })).toMatchObject({
      ok: false,
      reason: 'quote_changed',
    })
    expect(prepare({ quote: { ...quote, venue: 'UBS' } })).toMatchObject({
      ok: false,
      reason: 'quote_changed',
    })
  })
})
