import { describe, expect, it, vi } from 'vitest'
import { MarketDataStore } from './MarketDataStore'
import {
  exampleHeartbeatMessage,
  examplePriceUpdateMessage,
  exampleSnapshotMessage,
  type PriceSnapshotMessage,
  type PriceUpdateMessage,
} from './types'

describe('MarketDataStore', () => {
  it('keeps the published snapshot stable until flush', () => {
    const store = new MarketDataStore(() => 100)
    const initialSnapshot = store.getSnapshot()

    store.ingest(exampleSnapshotMessage)

    expect(store.getSnapshot()).toBe(initialSnapshot)
    expect(store.getSnapshot().initialized).toBe(false)

    expect(store.flush()).toBe(true)
    expect(store.getSnapshot()).not.toBe(initialSnapshot)
    expect(store.getSnapshot()).toMatchObject({
      version: 1,
      initialized: true,
    })
    expect(store.getSnapshot().rows).toHaveLength(2)
  })

  it('normalizes nested quotes into grid-friendly rows', () => {
    const store = new MarketDataStore(() => 123)
    store.ingest(exampleSnapshotMessage)
    store.flush()

    expect(store.getSnapshot().rows[0]).toEqual({
      key: 'EUR/USD:CITI',
      instrument: 'EUR/USD',
      venue: 'CITI',
      bidPrice: 1.08472,
      bidSize: 1_000_000,
      askPrice: 1.0848,
      askSize: 1_000_000,
      tradable: true,
      streamId: 'stream-london-001',
      sequence: 1,
      receivedAt: 123,
    })
  })

  it('coalesces repeated updates for one row before flush', () => {
    let now = 100
    const store = new MarketDataStore(() => now)
    store.ingest(exampleSnapshotMessage)
    store.flush()

    store.ingest(examplePriceUpdateMessage)
    now = 101
    const latestUpdate: PriceUpdateMessage = {
      ...examplePriceUpdateMessage,
      sequence: 3,
      quote: {
        ...examplePriceUpdateMessage.quote,
        bid: { ...examplePriceUpdateMessage.quote.bid, price: 1.08475 },
        ask: { ...examplePriceUpdateMessage.quote.ask, price: 1.08483 },
      },
    }
    store.ingest(latestUpdate)
    store.flush()

    const snapshot = store.getSnapshot()
    expect(snapshot.changedRows).toHaveLength(1)
    expect(snapshot.changedRows[0]).toMatchObject({
      key: 'EUR/USD:CITI',
      bidPrice: 1.08475,
      askPrice: 1.08483,
      sequence: 3,
      receivedAt: 101,
    })
  })

  it('does not mutate an already-published snapshot during ingestion', () => {
    const store = new MarketDataStore()
    store.ingest(exampleSnapshotMessage)
    store.flush()
    const publishedSnapshot = store.getSnapshot()
    const publishedCitiRow = publishedSnapshot.rows.find(
      (row) => row.venue === 'CITI',
    )!

    store.ingest(examplePriceUpdateMessage)

    expect(store.getSnapshot()).toBe(publishedSnapshot)
    expect(publishedCitiRow.bidPrice).toBe(1.08472)
    store.flush()
    expect(store.getSnapshot().rows.find((row) => row.venue === 'CITI')?.bidPrice).toBe(
      1.08473,
    )
  })

  it('replaces previous state when a new snapshot is flushed', () => {
    const store = new MarketDataStore()
    store.ingest(exampleSnapshotMessage)
    store.flush()

    const replacement: PriceSnapshotMessage = {
      ...exampleSnapshotMessage,
      streamId: 'stream-reconnected',
      sequence: 20,
      quotes: [exampleSnapshotMessage.quotes[0]],
    }
    store.ingest(replacement)
    store.flush()

    expect(store.getSnapshot().rows).toHaveLength(1)
    expect(store.getSnapshot().removedKeys).toEqual(['EUR/USD:JPMORGAN'])
    expect(store.getSnapshot().rows[0].streamId).toBe('stream-reconnected')
  })

  it('notifies subscribers once per flush, not once per message', () => {
    const store = new MarketDataStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.ingest(exampleSnapshotMessage)
    store.ingest(examplePriceUpdateMessage)

    expect(listener).not.toHaveBeenCalled()
    store.flush()
    expect(listener).toHaveBeenCalledOnce()

    unsubscribe()
    store.ingest({ ...examplePriceUpdateMessage, sequence: 3 })
    store.flush()
    expect(listener).toHaveBeenCalledOnce()
  })

  it('ignores heartbeats because they do not change quote state', () => {
    const store = new MarketDataStore()
    const snapshotBefore = store.getSnapshot()

    expect(store.ingest(exampleHeartbeatMessage)).toBe(false)
    expect(store.flush()).toBe(false)
    expect(store.getSnapshot()).toBe(snapshotBefore)
  })

  it('does not publish or notify when there are no pending changes', () => {
    const store = new MarketDataStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const snapshotBefore = store.getSnapshot()

    expect(store.flush()).toBe(false)
    expect(store.getSnapshot()).toBe(snapshotBefore)
    expect(listener).not.toHaveBeenCalled()
  })

  it('rejects an update before the initial snapshot', () => {
    const store = new MarketDataStore()

    expect(() => store.ingest(examplePriceUpdateMessage)).toThrow(
      'before a snapshot',
    )
  })

  it('rejects duplicate row identities in a direct snapshot', () => {
    const store = new MarketDataStore()
    const duplicateQuote = exampleSnapshotMessage.quotes[0]
    const invalidSnapshot: PriceSnapshotMessage = {
      ...exampleSnapshotMessage,
      quotes: [duplicateQuote, duplicateQuote],
    }

    expect(() => store.ingest(invalidSnapshot)).toThrow('duplicate quote')
  })
})
