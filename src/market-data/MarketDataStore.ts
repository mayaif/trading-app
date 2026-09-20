import type {
  CurrencyPair,
  MarketDataMessage,
  PriceQuote,
  PriceSnapshotMessage,
  PriceUpdateMessage,
  Venue,
} from './types'

/** A flat, grid-friendly representation of the latest quote for one venue. */
export type MarketDataRow = Readonly<{
  key: string
  instrument: CurrencyPair
  venue: Venue
  bidPrice: number
  bidSize: number
  askPrice: number
  askSize: number
  tradable: boolean
  streamId: string
  sequence: number
  receivedAt: number
}>

export type MarketDataStoreSnapshot = Readonly<{
  version: number
  initialized: boolean
  rows: readonly MarketDataRow[]
  changedRows: readonly MarketDataRow[]
  removedKeys: readonly string[]
}>

type MutableMarketDataRow = {
  -readonly [Field in keyof MarketDataRow]: MarketDataRow[Field]
}

type Listener = () => void

const EMPTY_SNAPSHOT: MarketDataStoreSnapshot = {
  version: 0,
  initialized: false,
  rows: [],
  changedRows: [],
  removedKeys: [],
}

/**
 * Normalizes accepted market data by instrument and venue.
 *
 * `ingest` is the high-frequency path and does not notify subscribers.
 * `flush` publishes one stable immutable snapshot for all pending changes.
 */
export class MarketDataStore {
  private readonly now: () => number
  private readonly listeners = new Set<Listener>()

  private committedRows = new Map<string, MarketDataRow>()
  private pendingUpdates = new Map<string, MutableMarketDataRow>()
  private pendingReplacement: Map<string, MutableMarketDataRow> | undefined
  private hasBaseline = false
  private currentSnapshot = EMPTY_SNAPSHOT

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  getSnapshot = (): MarketDataStoreSnapshot => this.currentSnapshot

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Returns true when the message changed pending quote state. */
  ingest(message: MarketDataMessage): boolean {
    if (message.type === 'heartbeat') return false

    const receivedAt = this.now()
    if (message.type === 'price_snapshot') {
      this.ingestSnapshot(message, receivedAt)
    } else {
      this.ingestUpdate(message, receivedAt)
    }
    return true
  }

  /** Publishes all pending changes as one snapshot and one notification. */
  flush(): boolean {
    if (!this.pendingReplacement && this.pendingUpdates.size === 0) {
      return false
    }

    let changedRows: readonly MarketDataRow[]
    let removedKeys: readonly string[] = []

    if (this.pendingReplacement) {
      removedKeys = [...this.committedRows.keys()].filter(
        (key) => !this.pendingReplacement!.has(key),
      )
      this.committedRows = this.pendingReplacement
      changedRows = [...this.pendingReplacement.values()]
      this.pendingReplacement = undefined
    } else {
      changedRows = [...this.pendingUpdates.values()]
      for (const [key, row] of this.pendingUpdates) {
        this.committedRows.set(key, row)
      }
    }

    this.pendingUpdates.clear()
    this.currentSnapshot = {
      version: this.currentSnapshot.version + 1,
      initialized: true,
      rows: [...this.committedRows.values()],
      changedRows,
      removedKeys,
    }
    this.listeners.forEach((listener) => listener())
    return true
  }

  private ingestSnapshot(
    message: PriceSnapshotMessage,
    receivedAt: number,
  ): void {
    const replacement = new Map<string, MutableMarketDataRow>()
    for (const quote of message.quotes) {
      const key = createQuoteKey(quote.instrument, quote.venue)
      if (replacement.has(key)) {
        throw new Error(`Snapshot contains a duplicate quote for ${key}.`)
      }
      replacement.set(
        key,
        createRow(quote, message.streamId, message.sequence, receivedAt),
      )
    }

    this.pendingReplacement = replacement
    this.pendingUpdates.clear()
    this.hasBaseline = true
  }

  private ingestUpdate(message: PriceUpdateMessage, receivedAt: number): void {
    if (!this.hasBaseline) {
      throw new Error('Cannot ingest a price update before a snapshot.')
    }

    const { quote } = message
    const key = createQuoteKey(quote.instrument, quote.venue)

    if (this.pendingReplacement) {
      const existingRow = this.pendingReplacement.get(key)
      if (existingRow) {
        updateRow(existingRow, quote, message, receivedAt)
      } else {
        this.pendingReplacement.set(
          key,
          createRow(quote, message.streamId, message.sequence, receivedAt),
        )
      }
      return
    }

    const pendingRow = this.pendingUpdates.get(key)
    if (pendingRow) {
      updateRow(pendingRow, quote, message, receivedAt)
    } else {
      this.pendingUpdates.set(
        key,
        createRow(quote, message.streamId, message.sequence, receivedAt),
      )
    }
  }
}

export function createQuoteKey(instrument: CurrencyPair, venue: Venue): string {
  return `${instrument}:${venue}`
}

function createRow(
  quote: PriceQuote,
  streamId: string,
  sequence: number,
  receivedAt: number,
): MutableMarketDataRow {
  return {
    key: createQuoteKey(quote.instrument, quote.venue),
    instrument: quote.instrument,
    venue: quote.venue,
    bidPrice: quote.bid.price,
    bidSize: quote.bid.sizeInBaseCurrency,
    askPrice: quote.ask.price,
    askSize: quote.ask.sizeInBaseCurrency,
    tradable: quote.tradable,
    streamId,
    sequence,
    receivedAt,
  }
}

function updateRow(
  row: MutableMarketDataRow,
  quote: PriceQuote,
  message: PriceUpdateMessage,
  receivedAt: number,
): void {
  row.bidPrice = quote.bid.price
  row.bidSize = quote.bid.sizeInBaseCurrency
  row.askPrice = quote.ask.price
  row.askSize = quote.ask.sizeInBaseCurrency
  row.tradable = quote.tradable
  row.streamId = message.streamId
  row.sequence = message.sequence
  row.receivedAt = receivedAt
}
