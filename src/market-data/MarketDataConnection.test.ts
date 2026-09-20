import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeMarketDataWebSocket,
  WebSocketReadyState,
  type SocketCloseEvent,
  type SocketMessageEvent,
  type SocketOpenEvent,
  type WebSocketReadyStateValue,
} from './FakeMarketDataWebSocket'
import {
  MarketDataConnection,
  type ConnectionIssue,
  type ConnectionStatus,
  type MarketDataSocket,
} from './MarketDataConnection'
import type {
  HeartbeatMessage,
  MarketDataMessage,
  PriceSnapshotMessage,
  ServerMessage,
  SubscriptionAckMessage,
} from './types'

describe('MarketDataConnection', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('connects, subscribes and publishes accepted market data', () => {
    const statuses: ConnectionStatus[] = []
    const marketData: MarketDataMessage[] = []
    const connection = new MarketDataConnection({
      createSocket: () =>
        new FakeMarketDataWebSocket({
          connectionDelayMs: 10,
          serverOptions: {
            createSubscriptionId: () => 'subscription-001',
            simulatorOptions: { createStreamId: () => 'stream-001' },
          },
        }),
      createRequestId: () => 'request-001',
      onStatusChange: (status) => statuses.push(status),
      onMarketData: (message) => marketData.push(message),
    })

    connection.connect()
    expect(connection.status).toBe('connecting')

    vi.advanceTimersByTime(10)

    expect(statuses).toEqual([
      'connecting',
      'subscribing',
      'awaiting_snapshot',
      'live',
    ])
    expect(marketData[0]).toMatchObject({
      type: 'price_snapshot',
      streamId: 'stream-001',
    })

    vi.advanceTimersByTime(50)
    expect(marketData[1]).toMatchObject({
      type: 'price_update',
      streamId: 'stream-001',
      sequence: 2,
    })
    connection.disconnect()
    vi.runAllTimers()
  })

  it('sends a valid subscription when the socket opens', () => {
    const socket = new ManualSocket()
    const connection = new MarketDataConnection({
      createSocket: () => socket,
      createRequestId: () => 'request-controlled',
    })

    connection.connect()
    socket.open()

    expect(socket.sentFrames).toHaveLength(1)
    expect(JSON.parse(socket.sentFrames[0])).toEqual({
      type: 'subscribe',
      schemaVersion: 1,
      requestId: 'request-controlled',
      instruments: ['EUR/USD'],
    })
    expect(connection.status).toBe('subscribing')
  })

  it('reports malformed server frames without publishing market data', () => {
    const socket = new ManualSocket()
    const issues: ConnectionIssue[] = []
    const onMarketData = vi.fn()
    const connection = new MarketDataConnection({
      createSocket: () => socket,
      createRequestId: () => 'request-001',
      onIssue: (issue) => issues.push(issue),
      onMarketData,
    })
    connection.connect()
    socket.open()

    socket.receive('{bad json')

    expect(issues).toEqual([
      expect.objectContaining({ type: 'decode_error', reason: 'invalid_json' }),
    ])
    expect(onMarketData).not.toHaveBeenCalled()
  })

  it('moves out of sync when the processor detects a sequence gap', () => {
    const socket = new ManualSocket()
    const issues: ConnectionIssue[] = []
    const connection = new MarketDataConnection({
      createSocket: () => socket,
      createRequestId: () => 'request-001',
      onIssue: (issue) => issues.push(issue),
    })
    connection.connect()
    socket.open()
    socket.receiveMessage(acknowledgement)
    socket.receiveMessage(snapshot)
    socket.receiveMessage({ ...heartbeat, sequence: 4 })

    expect(connection.status).toBe('out_of_sync')
    expect(issues).toContainEqual({
      type: 'processing_result',
      result: {
        status: 'gap',
        streamId: 'stream-001',
        expectedSequence: 2,
        receivedSequence: 4,
      },
    })
  })

  it('disconnects cleanly and ignores events from the old socket', () => {
    const socket = new ManualSocket()
    const marketData: MarketDataMessage[] = []
    const connection = new MarketDataConnection({
      createSocket: () => socket,
      createRequestId: () => 'request-001',
      onMarketData: (message) => marketData.push(message),
    })
    connection.connect()
    socket.open()
    socket.receiveMessage(acknowledgement)
    socket.receiveMessage(snapshot)

    connection.disconnect()
    expect(connection.status).toBe('disconnecting')
    socket.finishClose()
    expect(connection.status).toBe('disconnected')

    socket.receiveMessage(heartbeat)
    expect(marketData).toHaveLength(1)
  })

  it('does not create a duplicate socket when connect is called twice', () => {
    const createSocket = vi.fn(() => new ManualSocket())
    const connection = new MarketDataConnection({ createSocket })

    connection.connect()
    connection.connect()

    expect(createSocket).toHaveBeenCalledOnce()
  })

  it('can create a fresh socket after disconnecting', () => {
    const sockets = [new ManualSocket(), new ManualSocket()]
    const createSocket = vi.fn(() => sockets.shift()!)
    let requestNumber = 0
    const connection = new MarketDataConnection({
      createSocket,
      createRequestId: () => `request-${++requestNumber}`,
    })

    connection.connect()
    const firstSocket = createSocket.mock.results[0].value
    firstSocket.finishClose()
    connection.connect()

    expect(createSocket).toHaveBeenCalledTimes(2)
    expect(connection.status).toBe('connecting')
  })
})

class ManualSocket implements MarketDataSocket {
  onopen: ((event: SocketOpenEvent) => void) | null = null
  onmessage: ((event: SocketMessageEvent) => void) | null = null
  onclose: ((event: SocketCloseEvent) => void) | null = null
  readonly sentFrames: string[] = []
  readyState: WebSocketReadyStateValue = WebSocketReadyState.CONNECTING

  open(): void {
    this.readyState = WebSocketReadyState.OPEN
    this.onopen?.({ type: 'open' })
  }

  send(data: string): void {
    if (this.readyState !== WebSocketReadyState.OPEN) throw new Error('not open')
    this.sentFrames.push(data)
  }

  receive(rawMessage: string): void {
    this.onmessage?.({ type: 'message', data: rawMessage })
  }

  receiveMessage(message: ServerMessage): void {
    this.receive(JSON.stringify(message))
  }

  close(): void {
    this.readyState = WebSocketReadyState.CLOSING
  }

  finishClose(): void {
    this.readyState = WebSocketReadyState.CLOSED
    this.onclose?.({ type: 'close', code: 1000, reason: '', wasClean: true })
  }
}

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

const heartbeat: HeartbeatMessage = {
  type: 'heartbeat',
  schemaVersion: 1,
  streamId: 'stream-001',
  sequence: 2,
  sentAt: 1_726_656_001_000,
}
