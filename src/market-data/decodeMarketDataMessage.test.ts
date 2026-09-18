import { describe, expect, it } from 'vitest'
import { decodeMarketDataMessage } from './decodeMarketDataMessage'
import {
  exampleHeartbeatMessage,
  examplePriceUpdateMessage,
  exampleSnapshotMessage,
} from './types'

const decodeJson = (value: unknown) =>
  decodeMarketDataMessage(JSON.stringify(value))

describe('decodeMarketDataMessage', () => {
  it.each([
    ['snapshot', exampleSnapshotMessage],
    ['price update', examplePriceUpdateMessage],
    ['heartbeat', exampleHeartbeatMessage],
  ])('accepts a valid %s', (_description, message) => {
    expect(decodeJson(message)).toEqual({ ok: true, message })
  })

  it('distinguishes malformed JSON from an invalid message', () => {
    expect(decodeMarketDataMessage('{not valid JSON')).toMatchObject({
      ok: false,
      reason: 'invalid_json',
    })

    expect(decodeJson({ hello: 'world' })).toMatchObject({
      ok: false,
      reason: 'invalid_message',
    })
  })

  it.each([
    ['an unsupported message type', { ...exampleHeartbeatMessage, type: 'news' }],
    ['an unsupported schema version', { ...exampleHeartbeatMessage, schemaVersion: 2 }],
    ['an empty stream ID', { ...exampleHeartbeatMessage, streamId: '  ' }],
    ['a zero sequence', { ...exampleHeartbeatMessage, sequence: 0 }],
    ['a fractional sequence', { ...exampleHeartbeatMessage, sequence: 1.5 }],
    ['a negative timestamp', { ...exampleHeartbeatMessage, sentAt: -1 }],
  ])('rejects %s', (_description, message) => {
    expect(decodeJson(message)).toMatchObject({
      ok: false,
      reason: 'invalid_message',
    })
  })

  it.each([
    ['unknown instrument', { instrument: 'GBP/USD' }],
    ['unknown venue', { venue: 'UNKNOWN_BANK' }],
  ])('rejects an %s', (_description, quoteChange) => {
    const message = {
      ...examplePriceUpdateMessage,
      quote: { ...examplePriceUpdateMessage.quote, ...quoteChange },
    }

    expect(decodeJson(message)).toMatchObject({
      ok: false,
      reason: 'invalid_message',
    })
  })

  it('rejects a crossed market where the bid is not below the ask', () => {
    const message = {
      ...examplePriceUpdateMessage,
      quote: {
        ...examplePriceUpdateMessage.quote,
        bid: { price: 1.085, sizeInBaseCurrency: 1_000_000 },
        ask: { price: 1.084, sizeInBaseCurrency: 1_000_000 },
      },
    }

    expect(decodeJson(message).ok).toBe(false)
  })

  it('rejects a tradable quote with no available liquidity', () => {
    const message = {
      ...examplePriceUpdateMessage,
      quote: {
        ...examplePriceUpdateMessage.quote,
        bid: { ...examplePriceUpdateMessage.quote.bid, sizeInBaseCurrency: 0 },
      },
    }

    expect(decodeJson(message).ok).toBe(false)
  })

  it('allows zero liquidity when the quote is not tradable', () => {
    const message = {
      ...examplePriceUpdateMessage,
      quote: {
        ...examplePriceUpdateMessage.quote,
        bid: { ...examplePriceUpdateMessage.quote.bid, sizeInBaseCurrency: 0 },
        ask: { ...examplePriceUpdateMessage.quote.ask, sizeInBaseCurrency: 0 },
        tradable: false,
      },
    }

    expect(decodeJson(message)).toEqual({ ok: true, message })
  })

  it('rejects duplicate instrument and venue entries in a snapshot', () => {
    const duplicateQuote = exampleSnapshotMessage.quotes[0]
    const message = {
      ...exampleSnapshotMessage,
      quotes: [duplicateQuote, duplicateQuote],
    }

    expect(decodeJson(message).ok).toBe(false)
  })

  it('allows additional fields on a valid message', () => {
    const message = {
      ...exampleHeartbeatMessage,
      serverRegion: 'london',
    }

    expect(decodeJson(message)).toEqual({ ok: true, message })
  })
})
