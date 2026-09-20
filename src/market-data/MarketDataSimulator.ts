import { generateNextQuote, type TickSamples } from './generateNextQuote'
import {
  VENUES,
  type HeartbeatMessage,
  type MarketDataMessage,
  type PriceQuote,
  type PriceSnapshotMessage,
  type PriceUpdateMessage,
  type Venue,
} from './types'

const PRICE_SCALE = 100_000

export type MarketDataSimulatorOptions = {
  readonly onMessage: (message: MarketDataMessage) => void
  readonly priceIntervalMs?: number
  readonly heartbeatIntervalMs?: number
  readonly random?: () => number
  readonly now?: () => number
  readonly createStreamId?: () => string
}

/**
 * A small in-process stand-in for a market-data server.
 *
 * It produces domain messages, not JSON or WebSocket events. A later transport
 * adapter will be responsible for serialising these messages across the fake
 * network boundary.
 */
export class MarketDataSimulator {
  private readonly onMessage: (message: MarketDataMessage) => void
  private readonly priceIntervalMs: number
  private readonly heartbeatIntervalMs: number
  private readonly random: () => number
  private readonly now: () => number
  private readonly createStreamId: () => string

  private quotes = new Map<Venue, PriceQuote>()
  private streamId = ''
  private sequence = 0
  private running = false
  private priceTimer: ReturnType<typeof setInterval> | undefined
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined

  constructor({
    onMessage,
    priceIntervalMs = 50,
    heartbeatIntervalMs = 1_000,
    random = Math.random,
    now = Date.now,
    createStreamId = () => `stream-${crypto.randomUUID()}`,
  }: MarketDataSimulatorOptions) {
    assertPositiveInterval(priceIntervalMs, 'priceIntervalMs')
    assertPositiveInterval(heartbeatIntervalMs, 'heartbeatIntervalMs')

    this.onMessage = onMessage
    this.priceIntervalMs = priceIntervalMs
    this.heartbeatIntervalMs = heartbeatIntervalMs
    this.random = random
    this.now = now
    this.createStreamId = createStreamId
  }

  get isRunning(): boolean {
    return this.running
  }

  /** Starts a new stream. Calling start again while running is a no-op. */
  start(): void {
    if (this.isRunning) return

    this.streamId = this.createStreamId()
    this.sequence = 0
    this.quotes = createInitialQuoteMap()
    this.running = true

    try {
      this.emitSnapshot()
      this.priceTimer = setInterval(() => this.emitPriceUpdate(), this.priceIntervalMs)
      this.heartbeatTimer = setInterval(
        () => this.emitHeartbeat(),
        this.heartbeatIntervalMs,
      )
    } catch (error) {
      this.stop()
      throw error
    }
  }

  /** Stops the stream. Calling stop more than once is safe. */
  stop(): void {
    if (this.priceTimer !== undefined) clearInterval(this.priceTimer)
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer)

    this.priceTimer = undefined
    this.heartbeatTimer = undefined
    this.running = false
  }

  private emitSnapshot(): void {
    const message: PriceSnapshotMessage = {
      type: 'price_snapshot',
      schemaVersion: 1,
      streamId: this.streamId,
      sequence: this.nextSequence(),
      sentAt: this.now(),
      quotes: [...this.quotes.values()],
    }

    this.onMessage(message)
  }

  private emitPriceUpdate(): void {
    const venue = VENUES[Math.floor(this.nextRandom() * VENUES.length)]
    const previousQuote = this.quotes.get(venue)

    // Every configured venue is inserted when a stream starts. This guard also
    // protects future refactors from turning a missing quote into an exception.
    if (!previousQuote) return

    const samples: TickSamples = {
      midPriceMove: this.nextRandom(),
      spread: this.nextRandom(),
      bidSize: this.nextRandom(),
      askSize: this.nextRandom(),
    }
    const quote = generateNextQuote(previousQuote, samples)
    this.quotes.set(venue, quote)

    const message: PriceUpdateMessage = {
      type: 'price_update',
      schemaVersion: 1,
      streamId: this.streamId,
      sequence: this.nextSequence(),
      sentAt: this.now(),
      quote,
    }

    this.onMessage(message)
  }

  private emitHeartbeat(): void {
    const message: HeartbeatMessage = {
      type: 'heartbeat',
      schemaVersion: 1,
      streamId: this.streamId,
      sequence: this.nextSequence(),
      sentAt: this.now(),
    }

    this.onMessage(message)
  }

  private nextSequence(): number {
    this.sequence += 1
    return this.sequence
  }

  private nextRandom(): number {
    const sample = this.random()
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError('The random source must return values in [0, 1).')
    }
    return sample
  }
}

function createInitialQuoteMap(): Map<Venue, PriceQuote> {
  const venueSettings: ReadonlyArray<{
    venue: Venue
    midOffsetInPipettes: number
    spreadInPipettes: number
    sizeInBaseCurrency: number
  }> = [
    { venue: 'BARCLAYS', midOffsetInPipettes: -2, spreadInPipettes: 10, sizeInBaseCurrency: 1_000_000 },
    { venue: 'CITI', midOffsetInPipettes: 0, spreadInPipettes: 8, sizeInBaseCurrency: 2_000_000 },
    { venue: 'DEUTSCHE_BANK', midOffsetInPipettes: 1, spreadInPipettes: 10, sizeInBaseCurrency: 1_000_000 },
    { venue: 'JPMORGAN', midOffsetInPipettes: -1, spreadInPipettes: 8, sizeInBaseCurrency: 2_000_000 },
    { venue: 'UBS', midOffsetInPipettes: 2, spreadInPipettes: 12, sizeInBaseCurrency: 5_000_000 },
  ]
  const baseMidInPipettes = 108_476

  return new Map(
    venueSettings.map(({ venue, midOffsetInPipettes, spreadInPipettes, sizeInBaseCurrency }) => {
      const mid = baseMidInPipettes + midOffsetInPipettes
      const halfSpread = spreadInPipettes / 2
      return [
        venue,
        {
          instrument: 'EUR/USD',
          venue,
          bid: { price: (mid - halfSpread) / PRICE_SCALE, sizeInBaseCurrency },
          ask: { price: (mid + halfSpread) / PRICE_SCALE, sizeInBaseCurrency },
          tradable: true,
        },
      ]
    }),
  )
}

function assertPositiveInterval(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`)
  }
}
