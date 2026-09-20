import type { ConnectionStatus } from '../market-data/MarketDataConnection'
import type { MarketDataRow } from '../market-data/MarketDataStore'
import type {
  OrderDraft,
  OrderRejectionReason,
  OrderRequest,
} from './types'

export type PrepareOrderRequestOptions = Readonly<{
  draft: OrderDraft
  quote: MarketDataRow | undefined
  connectionStatus: ConnectionStatus
  now: number
  createClientOrderId: () => string
  maximumQuoteAgeMs?: number
}>

export type OrderPreparationResult =
  | Readonly<{ ok: true; request: OrderRequest }>
  | Readonly<{
      ok: false
      reason: OrderRejectionReason
      message: string
    }>

/** Validates user intent and captures the exact executable quote. */
export function prepareOrderRequest({
  draft,
  quote,
  connectionStatus,
  now,
  createClientOrderId,
  maximumQuoteAgeMs = 1_500,
}: PrepareOrderRequestOptions): OrderPreparationResult {
  if (
    !Number.isFinite(draft.quantityInBaseCurrency) ||
    draft.quantityInBaseCurrency <= 0
  ) {
    return reject('invalid_quantity', 'Quantity must be a positive number.')
  }

  if (connectionStatus !== 'live') {
    return reject(
      'connection_not_live',
      'Orders can only be submitted while market data is live.',
    )
  }

  if (
    !quote ||
    quote.instrument !== draft.instrument ||
    quote.venue !== draft.venue
  ) {
    return reject('quote_changed', 'The selected quote is no longer available.')
  }

  if (!quote.tradable) {
    return reject('quote_not_tradable', 'The selected quote is not tradable.')
  }

  if (!Number.isFinite(maximumQuoteAgeMs) || maximumQuoteAgeMs <= 0) {
    throw new RangeError('maximumQuoteAgeMs must be a positive finite number.')
  }

  const quoteAgeMs = Math.max(0, now - quote.receivedAt)
  if (quoteAgeMs > maximumQuoteAgeMs) {
    return reject(
      'stale_quote',
      `The selected quote is ${quoteAgeMs} ms old and cannot be traded.`,
    )
  }

  return {
    ok: true,
    request: {
      clientOrderId: createClientOrderId(),
      instrument: draft.instrument,
      venue: draft.venue,
      side: draft.side,
      quantityInBaseCurrency: draft.quantityInBaseCurrency,
      quote: {
        streamId: quote.streamId,
        sequence: quote.sequence,
        receivedAt: quote.receivedAt,
        price: draft.side === 'buy' ? quote.askPrice : quote.bidPrice,
      },
      submittedAt: now,
    },
  }
}

function reject(
  reason: OrderRejectionReason,
  message: string,
): OrderPreparationResult {
  return { ok: false, reason, message }
}
