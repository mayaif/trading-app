import { isMarketDataMessage } from './decodeMarketDataMessage'
import {
  CURRENCY_PAIRS,
  type CurrencyPair,
  type ServerMessage,
  type SubscriptionAckMessage,
} from './types'

export type ServerMessageDecodeResult =
  | { readonly ok: true; readonly message: ServerMessage }
  | {
      readonly ok: false
      readonly reason: 'invalid_json' | 'invalid_message'
      readonly error: string
    }

const currencyPairs: ReadonlySet<string> = new Set(CURRENCY_PAIRS)

/** Validates both control messages and market-data messages from the server. */
export function decodeServerMessage(rawMessage: string): ServerMessageDecodeResult {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawMessage) as unknown
  } catch {
    return {
      ok: false,
      reason: 'invalid_json',
      error: 'The server frame is not valid JSON.',
    }
  }

  if (!isMarketDataMessage(parsed) && !isSubscriptionAckMessage(parsed)) {
    return {
      ok: false,
      reason: 'invalid_message',
      error: 'The JSON value does not satisfy the server-message contract.',
    }
  }

  return { ok: true, message: parsed }
}

function isSubscriptionAckMessage(
  value: unknown,
): value is SubscriptionAckMessage {
  if (!isRecord(value)) return false
  if (value.type !== 'subscription_ack' || value.schemaVersion !== 1) return false
  if (!isNonEmptyString(value.requestId)) return false
  if (!isNonEmptyString(value.subscriptionId)) return false
  if (
    typeof value.sentAt !== 'number' ||
    !Number.isSafeInteger(value.sentAt) ||
    value.sentAt < 0
  ) {
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
