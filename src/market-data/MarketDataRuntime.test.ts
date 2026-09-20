import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeMarketDataWebSocket } from './FakeMarketDataWebSocket'
import { MarketDataRuntime } from './MarketDataRuntime'

describe('MarketDataRuntime', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function createRuntime(): MarketDataRuntime {
    return new MarketDataRuntime({
      createSocket: () =>
        new FakeMarketDataWebSocket({
          connectionDelayMs: 0,
          serverOptions: {
            simulatorOptions: {
              priceIntervalMs: 1_000,
              createStreamId: () => 'stream-runtime',
            },
          },
        }),
      flushIntervalMs: 100,
      connectionOptions: {
        createRequestId: () => 'request-runtime',
      },
    })
  }

  it('starts the complete pipeline and publishes its first batch', () => {
    const runtime = createRuntime()
    const storeListener = vi.fn()
    runtime.store.subscribe(storeListener)

    runtime.start()
    vi.advanceTimersByTime(0)

    expect(runtime.getStatusSnapshot()).toBe('live')
    expect(runtime.store.getSnapshot().initialized).toBe(false)

    vi.advanceTimersByTime(100)
    expect(storeListener).toHaveBeenCalledOnce()
    expect(runtime.store.getSnapshot().rows).toHaveLength(5)
    runtime.stop()
    vi.runOnlyPendingTimers()
  })

  it('starts only one pipeline when called repeatedly', () => {
    const createSocket = vi.fn(
      () => new FakeMarketDataWebSocket({ connectionDelayMs: 0 }),
    )
    const runtime = new MarketDataRuntime({ createSocket })

    runtime.start()
    runtime.start()

    expect(createSocket).toHaveBeenCalledOnce()
    runtime.stop()
    vi.runOnlyPendingTimers()
  })

  it('publishes status changes through an external-store subscription', () => {
    const runtime = createRuntime()
    const listener = vi.fn()
    const unsubscribe = runtime.subscribeToStatus(listener)

    runtime.start()
    vi.advanceTimersByTime(0)

    expect(listener).toHaveBeenCalled()
    expect(runtime.getStatusSnapshot()).toBe('live')

    unsubscribe()
    runtime.stop()
    expect(runtime.getStatusSnapshot()).toBe('disconnected')
  })

  it('can stop and immediately restart safely for React Strict Mode', () => {
    const createSocket = vi.fn(
      () => new FakeMarketDataWebSocket({ connectionDelayMs: 0 }),
    )
    const runtime = new MarketDataRuntime({ createSocket })

    runtime.start()
    runtime.stop()
    runtime.start()
    vi.runOnlyPendingTimers()

    expect(createSocket).toHaveBeenCalledTimes(2)
    expect(runtime.getStatusSnapshot()).toBe('live')
    runtime.stop()
    vi.runOnlyPendingTimers()
  })

  it('restarts the fake feed when its load profile changes', () => {
    const createSocket = vi.fn(
      () => new FakeMarketDataWebSocket({ connectionDelayMs: 0 }),
    )
    const runtime = new MarketDataRuntime({ createSocket })
    const profileListener = vi.fn()
    runtime.subscribeToLoadProfile(profileListener)

    runtime.start()
    vi.advanceTimersByTime(0)
    runtime.setLoadProfile('stress')
    vi.advanceTimersByTime(0)

    expect(profileListener).toHaveBeenCalledOnce()
    expect(runtime.getLoadProfileSnapshot()).toBe('stress')
    expect(createSocket).toHaveBeenNthCalledWith(1, 'normal')
    expect(createSocket).toHaveBeenNthCalledWith(2, 'stress')
    expect(runtime.getStatusSnapshot()).toBe('live')

    runtime.stop()
    vi.runOnlyPendingTimers()
  })

  it('does not restart when the selected load profile is already active', () => {
    const createSocket = vi.fn(
      () => new FakeMarketDataWebSocket({ connectionDelayMs: 0 }),
    )
    const runtime = new MarketDataRuntime({ createSocket })

    runtime.start()
    runtime.setLoadProfile('normal')

    expect(createSocket).toHaveBeenCalledOnce()
    runtime.stop()
    vi.runOnlyPendingTimers()
  })
})
