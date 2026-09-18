import {
  CURRENCY_PAIRS,
  VENUES,
  type CurrencyPair,
  type MarketDataMessage,
  type MessageEnvelope,
  type PriceLevel,
  type PriceQuote,
  type Venue,
} from './types'

/** A failed decode is data, not an exception that can break the stream. */
export type DecodeFailure = {
  readonly ok: false
  readonly reason: 'invalid_json' | 'invalid_message'
  readonly error: string
}

export type DecodeSuccess = {
  readonly ok: true
  readonly message: MarketDataMessage
}

export type DecodeResult = DecodeSuccess | DecodeFailure

const currencyPairSet: ReadonlySet<string> = new Set(CURRENCY_PAIRS)
const venueSet: ReadonlySet<string> = new Set(VENUES)

/**
 * Converts an untrusted WebSocket text frame into a checked domain message.
 * Callers must inspect `ok` before they can access `message`.
 */
export function decodeMarketDataMessage(rawMessage: string): DecodeResult {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawMessage) as unknown
  } catch {
    return {
      ok: false,
      reason: 'invalid_json',
      error: 'The WebSocket frame is not valid JSON.',
    }
  }

  if (!isMarketDataMessage(parsed)) {
    return {
      ok: false,
      reason: 'invalid_message',
      error: 'The JSON value does not satisfy the market-data contract.',
    }
  }

  return { ok: true, message: parsed }
}

/**
 * A type guard performs the runtime checks and narrows `unknown` for
 * TypeScript. Extra object fields are tolerated for forward compatibility.
 */
export function isMarketDataMessage(value: unknown): value is MarketDataMessage {
  if (!isMessageEnvelope(value)) return false

  switch (value.type) {
    case 'price_snapshot':
      return isPriceSnapshot(value)
    case 'price_update':
      return isPriceQuote(value.quote)
    case 'heartbeat':
      return true
    default:
      return false
  }
}

function isMessageEnvelope(
  value: unknown,
): value is MessageEnvelope<string> & Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    value.schemaVersion === 1 &&
    typeof value.streamId === 'string' &&
    value.streamId.trim().length > 0 &&
    isPositiveSafeInteger(value.sequence) &&
    isNonNegativeSafeInteger(value.sentAt)
  )
}

function isPriceSnapshot(
  value: MessageEnvelope<string> & Record<string, unknown>,
): boolean {
  if (!Array.isArray(value.quotes) || !value.quotes.every(isPriceQuote)) {
    return false
  }

  // A snapshot cannot contain two competing values for the same row identity.
  const quoteKeys = value.quotes.map(
    (quote: PriceQuote) => `${quote.instrument}:${quote.venue}`,
  )
  return new Set(quoteKeys).size === quoteKeys.length
}

function isPriceQuote(value: unknown): value is PriceQuote {
  if (!isRecord(value)) return false
  if (!isCurrencyPair(value.instrument) || !isVenue(value.venue)) return false
  if (!isPriceLevel(value.bid) || !isPriceLevel(value.ask)) return false
  if (typeof value.tradable !== 'boolean') return false
  if (value.bid.price >= value.ask.price) return false

  // A tradable quote must offer liquidity on both sides.
  if (
    value.tradable &&
    (value.bid.sizeInBaseCurrency === 0 || value.ask.sizeInBaseCurrency === 0)
  ) {
    return false
  }

  return true
}

function isPriceLevel(value: unknown): value is PriceLevel {
  return (
    isRecord(value) &&
    isPositiveFiniteNumber(value.price) &&
    isNonNegativeFiniteNumber(value.sizeInBaseCurrency)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCurrencyPair(value: unknown): value is CurrencyPair {
  return typeof value === 'string' && currencyPairSet.has(value)
}

function isVenue(value: unknown): value is Venue {
  return typeof value === 'string' && venueSet.has(value)
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
