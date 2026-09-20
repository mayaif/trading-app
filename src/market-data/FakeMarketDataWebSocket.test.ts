import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeServerMessage } from './decodeServerMessage'
import {
  FakeMarketDataWebSocket,
  WebSocketReadyState,
  type SocketCloseEvent,
} from './FakeMarketDataWebSocket'
import type { SubscribeMessage } from './types'

const subscribeMessage: SubscribeMessage = {
  type: 'subscribe',
  schemaVersion: 1,
  requestId: 'request-001',
  instruments: ['EUR/USD'],
}

describe('FakeMarketDataWebSocket', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('moves from connecting to open after the configured delay', () => {
    const socket = new FakeMarketDataWebSocket({ connectionDelayMs: 100 })
    const onOpen = vi.fn()
    socket.onopen = onOpen

    expect(socket.readyState).toBe(WebSocketReadyState.CONNECTING)
    vi.advanceTimersByTime(99)
    expect(onOpen).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(socket.readyState).toBe(WebSocketReadyState.OPEN)
    expect(onOpen).toHaveBeenCalledWith({ type: 'open' })
    socket.close()
  })

  it('does not deliver market data until the client subscribes', () => {
    const socket = new FakeMarketDataWebSocket({
      connectionDelayMs: 0,
      serverOptions: {
        createSubscriptionId: () => 'subscription-test-001',
        now: () => 1_726_656_000_000,
        simulatorOptions: { createStreamId: () => 'stream-wire-test' },
      },
    })
    const receivedFrames: string[] = []
    socket.onmessage = ({ data }) => receivedFrames.push(data)

    vi.advanceTimersByTime(0)
    expect(receivedFrames).toHaveLength(0)

    socket.send(JSON.stringify(subscribeMessage))

    const messages = receivedFrames.map((frame) => {
      const result = decodeServerMessage(frame)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error)
      return result.message
    })
    expect(messages.map((message) => message.type)).toEqual([
      'subscription_ack',
      'price_snapshot',
    ])
    expect(messages[0]).toMatchObject({
      type: 'subscription_ack',
      requestId: 'request-001',
      subscriptionId: 'subscription-test-001',
    })
    expect(messages[1]).toMatchObject({
      type: 'price_snapshot',
      streamId: 'stream-wire-test',
    })
    socket.close()
  })

  it('forwards client text frames only while open', () => {
    const receiveClientFrame = vi.fn()
    const socket = new FakeMarketDataWebSocket({
      connectionDelayMs: 10,
      createServerSession: () => ({
        receiveClientFrame,
        close: vi.fn(),
      }),
    })

    expect(() => socket.send('client frame')).toThrowError(
      expect.objectContaining({ name: 'InvalidStateError' }),
    )

    vi.advanceTimersByTime(10)
    socket.send('client frame')
    expect(receiveClientFrame).toHaveBeenCalledWith('client frame')

    socket.close()
    expect(() => socket.send('another frame')).toThrowError(
      expect.objectContaining({ name: 'InvalidStateError' }),
    )
  })

  it('performs a clean client-initiated close and closes the server session', () => {
    const closeServerSession = vi.fn()
    const socket = new FakeMarketDataWebSocket({
      connectionDelayMs: 0,
      closeDelayMs: 25,
      createServerSession: () => ({
        receiveClientFrame: vi.fn(),
        close: closeServerSession,
      }),
    })
    const closeEvents: SocketCloseEvent[] = []
    socket.onclose = (event) => closeEvents.push(event)
    vi.advanceTimersByTime(0)

    socket.close(1000, 'Finished')
    expect(socket.readyState).toBe(WebSocketReadyState.CLOSING)
    expect(closeServerSession).toHaveBeenCalledOnce()
    expect(closeEvents).toHaveLength(0)

    vi.advanceTimersByTime(25)
    expect(socket.readyState).toBe(WebSocketReadyState.CLOSED)
    expect(closeEvents).toEqual([
      { type: 'close', code: 1000, reason: 'Finished', wasClean: true },
    ])
  })

  it('can close while connecting without ever opening', () => {
    const receiveClientFrame = vi.fn()
    const socket = new FakeMarketDataWebSocket({
      connectionDelayMs: 100,
      createServerSession: () => ({
        receiveClientFrame,
        close: vi.fn(),
      }),
    })
    const onOpen = vi.fn()
    socket.onopen = onOpen

    socket.close()
    vi.runAllTimers()

    expect(socket.readyState).toBe(WebSocketReadyState.CLOSED)
    expect(onOpen).not.toHaveBeenCalled()
    expect(receiveClientFrame).not.toHaveBeenCalled()
  })

  it('reports an unexpected server disconnect as unclean', () => {
    const socket = new FakeMarketDataWebSocket({ connectionDelayMs: 0 })
    const onClose = vi.fn()
    socket.onclose = onClose
    vi.advanceTimersByTime(0)

    socket.simulateServerDisconnect('Network unavailable')

    expect(socket.readyState).toBe(WebSocketReadyState.CLOSED)
    expect(onClose).toHaveBeenCalledWith({
      type: 'close',
      code: 1006,
      reason: 'Network unavailable',
      wasClean: false,
    })
  })

  it('allows the open handler to close before any subscription', () => {
    const receiveClientFrame = vi.fn()
    const socket = new FakeMarketDataWebSocket({
      connectionDelayMs: 0,
      createServerSession: () => ({
        receiveClientFrame,
        close: vi.fn(),
      }),
    })
    socket.onopen = () => socket.close()

    vi.advanceTimersByTime(0)

    expect(receiveClientFrame).not.toHaveBeenCalled()
    expect(socket.readyState).toBe(WebSocketReadyState.CLOSING)

    vi.runAllTimers()
    expect(socket.readyState).toBe(WebSocketReadyState.CLOSED)
  })
})
