import { createQuoteKey, type MarketDataStore } from './MarketDataStore'
import type { MarketDataMessage } from './types'

export type BatchingMetrics = Readonly<{
  receivedMessages: number
  receivedSnapshots: number
  receivedPriceUpdates: number
  receivedHeartbeats: number
  flushChecks: number
  publishedBatches: number
  publishedRows: number
  coalescedPriceUpdates: number
}>

export type MarketDataBatcherOptions = {
  readonly store: MarketDataStore
  readonly flushIntervalMs?: number
}

/**
 * Schedules store publication independently from message arrival frequency.
 * Message ingestion remains synchronous; subscriber notification is batched.
 */
export class MarketDataBatcher {
  private readonly store: MarketDataStore
  private readonly flushIntervalMs: number
  private timer: ReturnType<typeof setInterval> | undefined

  private receivedMessages = 0
  private receivedSnapshots = 0
  private receivedPriceUpdates = 0
  private receivedHeartbeats = 0
  private flushChecks = 0
  private publishedBatches = 0
  private publishedRows = 0
  private coalescedPriceUpdates = 0
  private updatesSinceFlush = 0
  private readonly updatedKeysSinceFlush = new Set<string>()

  constructor({ store, flushIntervalMs = 100 }: MarketDataBatcherOptions) {
    if (!Number.isFinite(flushIntervalMs) || flushIntervalMs <= 0) {
      throw new RangeError('flushIntervalMs must be a positive finite number.')
    }

    this.store = store
    this.flushIntervalMs = flushIntervalMs
  }

  get isRunning(): boolean {
    return this.timer !== undefined
  }

  getMetrics(): BatchingMetrics {
    return {
      receivedMessages: this.receivedMessages,
      receivedSnapshots: this.receivedSnapshots,
      receivedPriceUpdates: this.receivedPriceUpdates,
      receivedHeartbeats: this.receivedHeartbeats,
      flushChecks: this.flushChecks,
      publishedBatches: this.publishedBatches,
      publishedRows: this.publishedRows,
      coalescedPriceUpdates: this.coalescedPriceUpdates,
    }
  }

  /** Starts one recurring flush schedule. Repeated calls are safe. */
  start(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => this.flushNow(), this.flushIntervalMs)
  }

  /** Stops future flushes without publishing pending data during cleanup. */
  stop(): void {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  ingest(message: MarketDataMessage): void {
    // Let the store validate and accept the message before counting it.
    this.store.ingest(message)
    this.receivedMessages += 1

    switch (message.type) {
      case 'price_snapshot':
        this.receivedSnapshots += 1
        // A snapshot replaces any unflushed incremental state.
        this.updatesSinceFlush = 0
        this.updatedKeysSinceFlush.clear()
        break
      case 'price_update':
        this.receivedPriceUpdates += 1
        this.updatesSinceFlush += 1
        this.updatedKeysSinceFlush.add(
          createQuoteKey(message.quote.instrument, message.quote.venue),
        )
        break
      case 'heartbeat':
        this.receivedHeartbeats += 1
        break
    }
  }

  /** Performs one scheduled check and returns whether a batch was published. */
  flushNow(): boolean {
    this.flushChecks += 1
    const published = this.store.flush()

    if (published) {
      const snapshot = this.store.getSnapshot()
      this.publishedBatches += 1
      this.publishedRows += snapshot.changedRows.length
      this.coalescedPriceUpdates += Math.max(
        0,
        this.updatesSinceFlush - this.updatedKeysSinceFlush.size,
      )
    }

    this.updatesSinceFlush = 0
    this.updatedKeysSinceFlush.clear()
    return published
  }
}
