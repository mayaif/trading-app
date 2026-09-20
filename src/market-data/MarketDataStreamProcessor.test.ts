import { describe, expect, it } from 'vitest'
import { MarketDataStreamProcessor } from './MarketDataStreamProcessor'
import type {
  HeartbeatMessage,
  PriceSnapshotMessage,
  PriceUpdateMessage,
  SubscriptionAckMessage,
} from './types'

const acknowledgement: SubscriptionAckMessage = {
  type: 'subscription_ack',
  schemaVersion: 1,
  requestId: 'request-001',
  subscriptionId: 'subscription-001',
  instruments: ['EUR/USD'],
  sentAt: 1_726_656_000_000,
}

const snapshot: PriceSnapshotMessage = {
  type: 'price_snapshot',
  schemaVersion: 1,
  streamId: 'stream-001',
  sequence: 1,
  sentAt: 1_726_656_000_001,
  quotes: [],
}

const priceUpdate: PriceUpdateMessage = {
  type: 'price_update',
  schemaVersion: 1,
  streamId: 'stream-001',
  sequence: 2,
  sentAt: 1_726_656_000_002,
  quote: {
    instrument: 'EUR/USD',
    venue: 'CITI',
    bid: { price: 1.08472, sizeInBaseCurrency: 1_000_000 },
    ask: { price: 1.0848, sizeInBaseCurrency: 1_000_000 },
    tradable: true,
  },
}

const heartbeat: HeartbeatMessage = {
  type: 'heartbeat',
  schemaVersion: 1,
  streamId: 'stream-001',
  sequence: 3,
  sentAt: 1_726_656_001_000,
}

function createLiveProcessor(): MarketDataStreamProcessor {
  const processor = new MarketDataStreamProcessor('request-001')
  processor.process(acknowledgement)
  processor.process(snapshot)
  return processor
}

describe('MarketDataStreamProcessor', () => {
  it('moves through acknowledgement, snapshot and live data in order', () => {
    const processor = new MarketDataStreamProcessor('request-001')

    expect(processor.state).toBe('awaiting_ack')
    expect(processor.process(acknowledgement).status).toBe('accepted')
    expect(processor.state).toBe('awaiting_snapshot')
    expect(processor.subscriptionId).toBe('subscription-001')

    expect(processor.process(snapshot).status).toBe('accepted')
    expect(processor.state).toBe('live')
    expect(processor.streamId).toBe('stream-001')
    expect(processor.lastSequence).toBe(1)

    expect(processor.process(priceUpdate).status).toBe('accepted')
    expect(processor.process(heartbeat).status).toBe('accepted')
    expect(processor.lastSequence).toBe(3)
  })

  it('ignores an acknowledgement for a different request', () => {
    const processor = new MarketDataStreamProcessor('request-001')
    const result = processor.process({
      ...acknowledgement,
      requestId: 'request-from-another-client',
    })

    expect(result).toEqual({
      status: 'ignored',
      reason: 'unexpected_acknowledgement',
    })
    expect(processor.state).toBe('awaiting_ack')
  })

  it.each([
    ['before acknowledgement', new MarketDataStreamProcessor('request-001')],
    [
      'before snapshot',
      (() => {
        const processor = new MarketDataStreamProcessor('request-001')
        processor.process(acknowledgement)
        return processor
      })(),
    ],
  ])('rejects market data received %s', (_description, processor) => {
    expect(processor.process(priceUpdate)).toEqual({
      status: 'protocol_error',
      reason: 'data_before_snapshot',
    })
  })

  it('ignores duplicate and older sequence numbers', () => {
    const processor = createLiveProcessor()
    processor.process(priceUpdate)

    expect(processor.process(priceUpdate)).toEqual({
      status: 'ignored',
      reason: 'duplicate_or_old_sequence',
    })
    expect(processor.process({ ...heartbeat, sequence: 1 })).toEqual({
      status: 'ignored',
      reason: 'duplicate_or_old_sequence',
    })
    expect(processor.lastSequence).toBe(2)
  })

  it('detects a forward sequence gap and becomes out of sync', () => {
    const processor = createLiveProcessor()
    const result = processor.process({ ...priceUpdate, sequence: 4 })

    expect(result).toEqual({
      status: 'gap',
      streamId: 'stream-001',
      expectedSequence: 2,
      receivedSequence: 4,
    })
    expect(processor.state).toBe('out_of_sync')
    expect(processor.lastSequence).toBe(1)
  })

  it('ignores further incremental messages while out of sync', () => {
    const processor = createLiveProcessor()
    processor.process({ ...priceUpdate, sequence: 4 })

    expect(processor.process({ ...heartbeat, sequence: 5 })).toEqual({
      status: 'ignored',
      reason: 'out_of_sync',
    })
    expect(processor.lastSequence).toBe(1)
  })

  it('recovers from an out-of-sync state with a fresh snapshot', () => {
    const processor = createLiveProcessor()
    processor.process({ ...priceUpdate, sequence: 4 })

    const recoverySnapshot: PriceSnapshotMessage = {
      ...snapshot,
      streamId: 'stream-recovery',
      sequence: 20,
    }
    expect(processor.process(recoverySnapshot).status).toBe('accepted')
    expect(processor.state).toBe('live')
    expect(processor.streamId).toBe('stream-recovery')
    expect(processor.lastSequence).toBe(20)
  })

  it('ignores incremental data from a different stream', () => {
    const processor = createLiveProcessor()

    expect(
      processor.process({ ...priceUpdate, streamId: 'obsolete-stream' }),
    ).toEqual({ status: 'ignored', reason: 'different_stream' })
    expect(processor.state).toBe('live')
    expect(processor.lastSequence).toBe(1)
  })

  it('rejects an unexpected second snapshot while live', () => {
    const processor = createLiveProcessor()

    expect(processor.process(snapshot)).toEqual({
      status: 'protocol_error',
      reason: 'unexpected_snapshot',
    })
    expect(processor.state).toBe('live')
  })

  it('can reset all stream state for a new subscription attempt', () => {
    const processor = createLiveProcessor()
    processor.process(priceUpdate)

    processor.reset('request-002')

    expect(processor.state).toBe('awaiting_ack')
    expect(processor.subscriptionId).toBeUndefined()
    expect(processor.streamId).toBeUndefined()
    expect(processor.lastSequence).toBeUndefined()
    expect(processor.process(acknowledgement)).toEqual({
      status: 'ignored',
      reason: 'unexpected_acknowledgement',
    })
    expect(
      processor.process({ ...acknowledgement, requestId: 'request-002' }).status,
    ).toBe('accepted')
  })

  it('rejects an empty expected request ID', () => {
    expect(() => new MarketDataStreamProcessor('  ')).toThrow(TypeError)
  })
})
