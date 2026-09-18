import { describe, expect, it } from 'vitest'
import { generateNextQuote, type TickSamples } from './generateNextQuote'
import type { PriceQuote } from './types'

const startingQuote: PriceQuote = {
  instrument: 'EUR/USD',
  venue: 'CITI',
  bid: { price: 1.08472, sizeInBaseCurrency: 1_000_000 },
  ask: { price: 1.0848, sizeInBaseCurrency: 1_000_000 },
  tradable: true,
}

const middleSamples: TickSamples = {
  midPriceMove: 0.5,
  spread: 0.5,
  bidSize: 0.5,
  askSize: 0.5,
}

describe('generateNextQuote', () => {
  it('is deterministic for the same quote and samples', () => {
    expect(generateNextQuote(startingQuote, middleSamples)).toEqual(
      generateNextQuote(startingQuote, middleSamples),
    )
  })

  it('does not mutate the previous quote', () => {
    const originalValue = structuredClone(startingQuote)
    const nextQuote = generateNextQuote(startingQuote, middleSamples)

    expect(startingQuote).toEqual(originalValue)
    expect(nextQuote).not.toBe(startingQuote)
    expect(nextQuote.bid).not.toBe(startingQuote.bid)
    expect(nextQuote.ask).not.toBe(startingQuote.ask)
  })

  it('preserves the quote identity and tradability', () => {
    const nextQuote = generateNextQuote(startingQuote, middleSamples)

    expect(nextQuote).toMatchObject({
      instrument: 'EUR/USD',
      venue: 'CITI',
      tradable: true,
    })
  })

  it('uses the lowest price move, spread and sizes for zero samples', () => {
    const nextQuote = generateNextQuote(startingQuote, {
      midPriceMove: 0,
      spread: 0,
      bidSize: 0,
      askSize: 0,
    })

    expect(nextQuote).toMatchObject({
      bid: { price: 1.08471, sizeInBaseCurrency: 250_000 },
      ask: { price: 1.08477, sizeInBaseCurrency: 250_000 },
    })
  })

  it('uses the highest price move, spread and sizes near one', () => {
    const nextQuote = generateNextQuote(startingQuote, {
      midPriceMove: 0.999_999,
      spread: 0.999_999,
      bidSize: 0.999_999,
      askSize: 0.999_999,
    })

    expect(nextQuote).toMatchObject({
      bid: { price: 1.08472, sizeInBaseCurrency: 5_000_000 },
      ask: { price: 1.08484, sizeInBaseCurrency: 5_000_000 },
    })
  })

  it('always produces a bid below the ask at five-decimal precision', () => {
    const nextQuote = generateNextQuote(startingQuote, middleSamples)

    expect(nextQuote.bid.price).toBeLessThan(nextQuote.ask.price)
    expect(nextQuote.bid.price.toString().split('.')[1]).toHaveLength(5)
    expect(nextQuote.ask.price.toString().split('.')[1]).toHaveLength(5)
  })

  it.each([
    ['negative', -0.1],
    ['one', 1],
    ['infinite', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('rejects a %s random sample', (_description, invalidSample) => {
    expect(() =>
      generateNextQuote(startingQuote, {
        ...middleSamples,
        spread: invalidSample,
      }),
    ).toThrow(RangeError)
  })

  it('rejects an invalid previous market', () => {
    const crossedQuote: PriceQuote = {
      ...startingQuote,
      bid: { ...startingQuote.bid, price: 1.09 },
    }

    expect(() => generateNextQuote(crossedQuote, middleSamples)).toThrow(
      'valid two-sided market',
    )
  })
})
