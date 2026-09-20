import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeMarketDataWebSocket } from './FakeMarketDataWebSocket'
import { MarketDataBatcher } from './MarketDataBatcher'
import { MarketDataConnection } from './MarketDataConnection'
import { MarketDataStore } from './MarketDataStore'
import {
  exampleHeartbeatMessage,
  examplePriceUpdateMessage,
  exampleSnapshotMessage,
  type PriceUpdateMessage,
} from './types'

describe('MarketDataBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('publishes pending data only when the interval elapses', () => {
    const store = new MarketDataStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const batcher = new MarketDataBatcher({ store, flushIntervalMs: 100 })
    batcher.start()

    batcher.ingest(exampleSnapshotMessage)
    vi.advanceTimersByTime(99)
    expect(listener).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(listener).toHaveBeenCalledOnce()
    expect(store.getSnapshot().initialized).toBe(true)
    batcher.stop()
  })

  it('coalesces repeated updates to one changed row per batch', () => {
    const store = initializedStore()
    const batcher = new MarketDataBatcher({ store, flushIntervalMs: 100 })
    batcher.start()

    batcher.ingest(updateWithSequenceAndBid(2, 1.08473))
    batcher.ingest(updateWithSequenceAndBid(3, 1.08474))
    batcher.ingest(updateWithSequenceAndBid(4, 1.08475))
    vi.advanceTimersByTime(100)

    expect(store.getSnapshot().changedRows).toHaveLength(1)
    expect(store.getSnapshot().changedRows[0]).toMatchObject({
      bidPrice: 1.08475,
      sequence: 4,
    })
    expect(batcher.getMetrics()).toMatchObject({
      receivedPriceUpdates: 3,
      publishedBatches: 1,
      publishedRows: 1,
      coalescedPriceUpdates: 2,
    })
    batcher.stop()
  })

  it('does not publish heartbeat-only intervals', () => {
    const store = initializedStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const batcher = new MarketDataBatcher({ store, flushIntervalMs: 100 })
    batcher.start()

    batcher.ingest(exampleHeartbeatMessage)
    vi.advanceTimersByTime(300)

    expect(listener).not.toHaveBeenCalled()
    expect(batcher.getMetrics()).toMatchObject({
      receivedMessages: 1,
      receivedHeartbeats: 1,
      flushChecks: 3,
      publishedBatches: 0,
    })
    batcher.stop()
  })

  it('starts only one interval and stops it cleanly', () => {
    const store = new MarketDataStore()
    const batcher = new MarketDataBatcher({ store, flushIntervalMs: 100 })
    batcher.start()
    batcher.start()

    vi.advanceTimersByTime(200)
    expect(batcher.getMetrics().flushChecks).toBe(2)

    batcher.stop()
    vi.advanceTimersByTime(1_000)
    expect(batcher.getMetrics().flushChecks).toBe(2)
    expect(batcher.isRunning).toBe(false)
  })

  it('can flush immediately without waiting for the schedule', () => {
    const store = new MarketDataStore()
    const batcher = new MarketDataBatcher({ store })
    batcher.ingest(exampleSnapshotMessage)

    expect(batcher.flushNow()).toBe(true)
    expect(store.getSnapshot().initialized).toBe(true)
    expect(batcher.getMetrics().publishedBatches).toBe(1)
  })

  it('integrates connection messages without publishing per message', () => {
    const store = new MarketDataStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const batcher = new MarketDataBatcher({ store, flushIntervalMs: 100 })
    const connection = new MarketDataConnection({
      createSocket: () =>
        new FakeMarketDataWebSocket({
          connectionDelayMs: 0,
          serverOptions: {
            simulatorOptions: {
              priceIntervalMs: 1_000,
              createStreamId: () => 'stream-integration',
            },
          },
        }),
      createRequestId: () => 'request-integration',
      onMarketData: (message) => batcher.ingest(message),
    })
    batcher.start()
    connection.connect()

    vi.advanceTimersByTime(0)
    expect(connection.status).toBe('live')
    expect(listener).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(listener).toHaveBeenCalledOnce()
    expect(store.getSnapshot().rows).toHaveLength(5)

    connection.disconnect()
    batcher.stop()
    vi.runOnlyPendingTimers()
  })

  it('rejects an invalid flush interval', () => {
    expect(
      () => new MarketDataBatcher({ store: new MarketDataStore(), flushIntervalMs: 0 }),
    ).toThrow(RangeError)
  })
})

function initializedStore(): MarketDataStore {
  const store = new MarketDataStore()
  store.ingest(exampleSnapshotMessage)
  store.flush()
  return store
}

function updateWithSequenceAndBid(
  sequence: number,
  bidPrice: number,
): PriceUpdateMessage {
  return {
    ...examplePriceUpdateMessage,
    sequence,
    quote: {
      ...examplePriceUpdateMessage.quote,
      bid: { ...examplePriceUpdateMessage.quote.bid, price: bidPrice },
      ask: {
        ...examplePriceUpdateMessage.quote.ask,
        price: bidPrice + 0.00008,
      },
    },
  }
}
