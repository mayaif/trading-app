import {
  CURRENCY_PAIRS,
  type ClientMessage,
  type CurrencyPair,
} from './types'

export type ClientMessageDecodeResult =
  | { readonly ok: true; readonly message: ClientMessage }
  | {
      readonly ok: false
      readonly reason: 'invalid_json' | 'invalid_message'
      readonly error: string
    }

const currencyPairs: ReadonlySet<string> = new Set(CURRENCY_PAIRS)

/** Validates an untrusted client-to-server text frame. */
export function decodeClientMessage(rawMessage: string): ClientMessageDecodeResult {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawMessage) as unknown
  } catch {
    return {
      ok: false,
      reason: 'invalid_json',
      error: 'The client frame is not valid JSON.',
    }
  }

  if (!isSubscribeMessage(parsed)) {
    return {
      ok: false,
      reason: 'invalid_message',
      error: 'The JSON value is not a valid subscription request.',
    }
  }

  return { ok: true, message: parsed }
}

function isSubscribeMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value)) return false
  if (value.type !== 'subscribe' || value.schemaVersion !== 1) return false
  if (typeof value.requestId !== 'string' || value.requestId.trim() === '') {
    return false
  }
  if (!Array.isArray(value.instruments) || value.instruments.length === 0) {
    return false
  }
  if (!value.instruments.every(isCurrencyPair)) return false

  return new Set(value.instruments).size === value.instruments.length
}

function isCurrencyPair(value: unknown): value is CurrencyPair {
  return typeof value === 'string' && currencyPairs.has(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
