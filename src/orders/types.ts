import type { CurrencyPair, Venue } from '../market-data/types'

/** Buy or sell the base currency. For EUR/USD, that base currency is EUR. */
export const ORDER_SIDES = ['buy', 'sell'] as const
export type OrderSide = (typeof ORDER_SIDES)[number]

export const ORDER_STATUSES = [
  'pending',
  'acknowledged',
  'filled',
  'rejected',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_REJECTION_REASONS = [
  'invalid_quantity',
  'connection_not_live',
  'stale_quote',
  'quote_not_tradable',
  'quote_changed',
  'venue_rejected',
] as const
export type OrderRejectionReason =
  (typeof ORDER_REJECTION_REASONS)[number]

/**
 * Identifies the precise market-data version on which an order was based.
 * A sequence alone is insufficient because sequencing restarts on a new stream.
 */
export type QuoteReference = Readonly<{
  streamId: string
  sequence: number
  receivedAt: number
  price: number
}>

/** The immutable intent captured when the user presses Buy or Sell. */
export type OrderRequest = Readonly<{
  clientOrderId: string
  instrument: CurrencyPair
  venue: Venue
  side: OrderSide
  quantityInBaseCurrency: number
  quote: QuoteReference
  submittedAt: number
}>

export type PendingOrder = OrderRequest &
  Readonly<{
    status: 'pending'
  }>

export type AcknowledgedOrder = OrderRequest &
  Readonly<{
    status: 'acknowledged'
    executionOrderId: string
    acknowledgedAt: number
  }>

export type FilledOrder = OrderRequest &
  Readonly<{
    status: 'filled'
    executionOrderId: string
    acknowledgedAt: number
    filledAt: number
    fillPrice: number
    filledQuantityInBaseCurrency: number
  }>

/** Rejected before the simulated venue accepted the order. */
export type PreAcknowledgementRejection = OrderRequest &
  Readonly<{
    status: 'rejected'
    rejectionStage: 'pre_acknowledgement'
    rejectedAt: number
    rejectionReason: OrderRejectionReason
    rejectionMessage: string
  }>

/** Rejected after acknowledgement, for example by the simulated venue. */
export type PostAcknowledgementRejection = OrderRequest &
  Readonly<{
    status: 'rejected'
    rejectionStage: 'post_acknowledgement'
    executionOrderId: string
    acknowledgedAt: number
    rejectedAt: number
    rejectionReason: OrderRejectionReason
    rejectionMessage: string
  }>

export type RejectedOrder =
  | PreAcknowledgementRejection
  | PostAcknowledgementRejection

/**
 * Discriminated union for every valid order lifecycle state.
 * Reading `status` safely narrows the fields available to the caller.
 */
export type Order =
  | PendingOrder
  | AcknowledgedOrder
  | FilledOrder
  | RejectedOrder
