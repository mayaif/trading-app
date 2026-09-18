/**
 * The only instrument in this demo for now.
 *
 * A union type makes the permitted value explicit while still allowing us to
 * add more currency pairs later, for example: 'GBP/USD' | 'USD/JPY'.
 */
export const CURRENCY_PAIRS = ['EUR/USD'] as const
export type CurrencyPair = (typeof CURRENCY_PAIRS)[number]

/** The simulated liquidity providers that may publish a quote. */
export const VENUES = [
  'BARCLAYS',
  'CITI',
  'DEUTSCHE_BANK',
  'JPMORGAN',
  'UBS',
] as const
export type Venue = (typeof VENUES)[number]

/**
 * One side of a quote.
 *
 * For EUR/USD, `price` is USD per EUR and `sizeInBaseCurrency` is the amount
 * of EUR available. Naming the unit avoids an ambiguous generic `size` field.
 */
export type PriceLevel = {
  readonly price: number
  readonly sizeInBaseCurrency: number
}

/**
 * A two-sided, executable quote from one venue.
 *
 * The bid is the price at which the venue buys EUR.
 * The ask is the price at which the venue sells EUR.
 */
export type PriceQuote = {
  readonly instrument: CurrencyPair
  readonly venue: Venue
  readonly bid: PriceLevel
  readonly ask: PriceLevel
  readonly tradable: boolean
}

/**
 * Fields shared by every server-to-client market-data message.
 *
 * `type` is generic so each concrete message can provide its own string
 * literal. That literal becomes the discriminator for our message union.
 *
 * `streamId` identifies one server-side streaming session. It changes after a
 * reconnect, while `sequence` increases monotonically within that stream.
 *
 * `sentAt` is Unix time in milliseconds, produced by the simulated server.
 */
export type MessageEnvelope<MessageType extends string> = {
  readonly type: MessageType
  readonly schemaVersion: 1
  readonly streamId: string
  readonly sequence: number
  readonly sentAt: number
}

/**
 * The complete current market view, sent when a subscription starts or is
 * recovered. Consumers replace their existing quote state with this snapshot.
 */
export type PriceSnapshotMessage = MessageEnvelope<'price_snapshot'> & {
  readonly quotes: readonly PriceQuote[]
}

/**
 * One incremental change after the snapshot. The quote completely replaces
 * the previous quote for the same instrument and venue.
 */
export type PriceUpdateMessage = MessageEnvelope<'price_update'> & {
  readonly quote: PriceQuote
}

/**
 * A liveness message sent even when no prices change. It proves that the
 * stream is still active and participates in the same sequence as price data.
 */
export type HeartbeatMessage = MessageEnvelope<'heartbeat'>

/** Every server-to-client message currently supported by the protocol. */
export type MarketDataMessage =
  | PriceSnapshotMessage
  | PriceUpdateMessage
  | HeartbeatMessage

/** Example messages document one valid stream without running a simulator. */
export const exampleSnapshotMessage: PriceSnapshotMessage = {
  type: 'price_snapshot',
  schemaVersion: 1,
  streamId: 'stream-london-001',
  sequence: 1,
  sentAt: 1_726_656_000_000,
  quotes: [
    {
      instrument: 'EUR/USD',
      venue: 'CITI',
      bid: { price: 1.08472, sizeInBaseCurrency: 1_000_000 },
      ask: { price: 1.0848, sizeInBaseCurrency: 1_000_000 },
      tradable: true,
    },
    {
      instrument: 'EUR/USD',
      venue: 'JPMORGAN',
      bid: { price: 1.0847, sizeInBaseCurrency: 2_000_000 },
      ask: { price: 1.08479, sizeInBaseCurrency: 2_000_000 },
      tradable: true,
    },
  ],
}

export const examplePriceUpdateMessage: PriceUpdateMessage = {
  type: 'price_update',
  schemaVersion: 1,
  streamId: 'stream-london-001',
  sequence: 2,
  sentAt: 1_726_656_000_025,
  quote: {
    instrument: 'EUR/USD',
    venue: 'CITI',
    bid: { price: 1.08473, sizeInBaseCurrency: 1_000_000 },
    ask: { price: 1.08481, sizeInBaseCurrency: 1_000_000 },
    tradable: true,
  },
}

export const exampleHeartbeatMessage: HeartbeatMessage = {
  type: 'heartbeat',
  schemaVersion: 1,
  streamId: 'stream-london-001',
  sequence: 3,
  sentAt: 1_726_656_001_000,
}
