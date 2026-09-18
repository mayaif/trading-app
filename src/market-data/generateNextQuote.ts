import type { PriceQuote } from './types'

/** EUR/USD is normally displayed to five decimal places. */
export const EUR_USD_PRICE_SCALE = 100_000

const DEFAULT_SIZE_BUCKETS = [250_000, 500_000, 1_000_000, 2_000_000, 5_000_000] as const
const SPREAD_BUCKETS_IN_PIPETTES = [6, 8, 10, 12] as const

export type TickSamples = {
  /** Selects a mid-price move between -2 and +2 pipettes. */
  readonly midPriceMove: number
  /** Selects a spread of 6, 8, 10 or 12 pipettes. */
  readonly spread: number
  /** Selects the next bid size from the configured size buckets. */
  readonly bidSize: number
  /** Selects the next ask size from the configured size buckets. */
  readonly askSize: number
}

/**
 * Produces the next complete venue quote without mutating the previous quote.
 *
 * Every sample must be in the same [0, 1) range returned by Math.random().
 * Keeping samples outside this function makes the price calculation pure and
 * deterministic: the same quote and samples always produce the same result.
 */
export function generateNextQuote(
  previousQuote: PriceQuote,
  samples: TickSamples,
): PriceQuote {
  assertValidPreviousQuote(previousQuote)
  assertUnitIntervalSamples(samples)

  const previousMidInPipettes = Math.round(
    ((previousQuote.bid.price + previousQuote.ask.price) / 2) *
      EUR_USD_PRICE_SCALE,
  )

  const midMoveInPipettes = selectInteger(samples.midPriceMove, -2, 2)
  const spreadInPipettes = selectFromBuckets(
    samples.spread,
    SPREAD_BUCKETS_IN_PIPETTES,
  )
  const nextMidInPipettes = previousMidInPipettes + midMoveInPipettes

  const bidInPipettes = nextMidInPipettes - spreadInPipettes / 2
  const askInPipettes = nextMidInPipettes + spreadInPipettes / 2

  return {
    instrument: previousQuote.instrument,
    venue: previousQuote.venue,
    bid: {
      price: fromPipettes(bidInPipettes),
      sizeInBaseCurrency: selectSize(samples.bidSize),
    },
    ask: {
      price: fromPipettes(askInPipettes),
      sizeInBaseCurrency: selectSize(samples.askSize),
    },
    tradable: previousQuote.tradable,
  }
}

function selectInteger(sample: number, minimum: number, maximum: number): number {
  return minimum + Math.floor(sample * (maximum - minimum + 1))
}

function selectSize(sample: number): number {
  return selectFromBuckets(sample, DEFAULT_SIZE_BUCKETS)
}

function selectFromBuckets(
  sample: number,
  buckets: readonly number[],
): number {
  return buckets[Math.floor(sample * buckets.length)]
}

function fromPipettes(value: number): number {
  return Number((value / EUR_USD_PRICE_SCALE).toFixed(5))
}

function assertValidPreviousQuote(quote: PriceQuote): void {
  if (
    !Number.isFinite(quote.bid.price) ||
    !Number.isFinite(quote.ask.price) ||
    quote.bid.price <= 0 ||
    quote.bid.price >= quote.ask.price
  ) {
    throw new RangeError('The previous quote must contain a valid two-sided market.')
  }
}

function assertUnitIntervalSamples(samples: TickSamples): void {
  for (const [name, sample] of Object.entries(samples)) {
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError(`${name} must be a finite number in the range [0, 1).`)
    }
  }
}
