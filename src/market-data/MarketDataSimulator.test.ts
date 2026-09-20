import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeMarketDataMessage } from './decodeMarketDataMessage'
import { MarketDataSimulator } from './MarketDataSimulator'
import { VENUES, type MarketDataMessage } from './types'

describe('MarketDataSimulator', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function createHarness(overrides: {
    priceIntervalMs?: number
    heartbeatIntervalMs?: number
    createStreamId?: () => string
  } = {}) {
    const messages: MarketDataMessage[] = []
    const simulator = new MarketDataSimulator({
      onMessage: (message) => messages.push(message),
      random: () => 0.5,
      now: () => Date.now(),
      createStreamId: () => 'stream-test-001',
      priceIntervalMs: 50,
      heartbeatIntervalMs: 1_000,
      ...overrides,
    })
    return { messages, simulator }
  }

  it('emits a complete snapshot immediately on start', () => {
    const { messages, simulator } = createHarness()
    simulator.start()

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      type: 'price_snapshot',
      streamId: 'stream-test-001',
      sequence: 1,
      sentAt: Date.now(),
    })

    const snapshot = messages[0]
    expect(snapshot.type).toBe('price_snapshot')
    if (snapshot.type !== 'price_snapshot') return

    expect(snapshot.quotes).toHaveLength(VENUES.length)
    expect(new Set(snapshot.quotes.map((quote) => quote.venue))).toEqual(
      new Set(VENUES),
    )
  })

  it('emits sequential price updates at the configured interval', () => {
    const { messages, simulator } = createHarness()
    simulator.start()

    vi.advanceTimersByTime(150)

    expect(messages.map((message) => message.type)).toEqual([
      'price_snapshot',
      'price_update',
      'price_update',
      'price_update',
    ])
    expect(messages.map((message) => message.sequence)).toEqual([1, 2, 3, 4])
  })

  it('emits heartbeats on the same ordered stream', () => {
    const { messages, simulator } = createHarness({
      priceIntervalMs: 10_000,
      heartbeatIntervalMs: 500,
    })
    simulator.start()

    vi.advanceTimersByTime(1_000)

    expect(messages.map(({ type, sequence }) => ({ type, sequence }))).toEqual([
      { type: 'price_snapshot', sequence: 1 },
      { type: 'heartbeat', sequence: 2 },
      { type: 'heartbeat', sequence: 3 },
    ])
  })

  it('stops all scheduled messages', () => {
    const { messages, simulator } = createHarness()
    simulator.start()
    vi.advanceTimersByTime(100)
    simulator.stop()
    const countAfterStop = messages.length

    vi.advanceTimersByTime(10_000)

    expect(messages).toHaveLength(countAfterStop)
    expect(simulator.isRunning).toBe(false)
  })

  it('does not create duplicate streams when start is called twice', () => {
    const { messages, simulator } = createHarness()
    simulator.start()
    simulator.start()
    vi.advanceTimersByTime(50)

    expect(messages.map((message) => message.type)).toEqual([
      'price_snapshot',
      'price_update',
    ])
  })

  it('prevents a message callback from re-entering start', () => {
    const messages: MarketDataMessage[] = []
    let simulator: MarketDataSimulator
    simulator = new MarketDataSimulator({
      onMessage: (message) => {
        messages.push(message)
        simulator.start()
      },
      createStreamId: () => 'stream-reentrant',
    })

    simulator.start()

    expect(messages).toHaveLength(1)
    expect(messages[0].type).toBe('price_snapshot')
    simulator.stop()
  })

  it('creates a new stream and resets sequencing after a restart', () => {
    let streamNumber = 0
    const { messages, simulator } = createHarness({
      createStreamId: () => `stream-${++streamNumber}`,
    })

    simulator.start()
    simulator.stop()
    simulator.start()

    expect(messages.map(({ streamId, sequence }) => ({ streamId, sequence }))).toEqual([
      { streamId: 'stream-1', sequence: 1 },
      { streamId: 'stream-2', sequence: 1 },
    ])
  })

  it('only emits messages accepted by the wire decoder', () => {
    const { messages, simulator } = createHarness({ heartbeatIntervalMs: 100 })
    simulator.start()
    vi.advanceTimersByTime(250)

    for (const message of messages) {
      expect(decodeMarketDataMessage(JSON.stringify(message)).ok).toBe(true)
    }
  })

  it.each([0, -1, Number.POSITIVE_INFINITY])(
    'rejects the invalid interval %s',
    (invalidInterval) => {
      expect(
        () =>
          new MarketDataSimulator({
            onMessage: () => undefined,
            priceIntervalMs: invalidInterval,
          }),
      ).toThrow(RangeError)
    },
  )
})
