import {
  FakeMarketDataServerSession,
  type FakeMarketDataServerSessionOptions,
} from './FakeMarketDataServerSession'
import type { ServerMessage } from './types'

export const WebSocketReadyState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const

export type WebSocketReadyStateValue =
  (typeof WebSocketReadyState)[keyof typeof WebSocketReadyState]

export type SocketOpenEvent = {
  readonly type: 'open'
}

export type SocketMessageEvent = {
  readonly type: 'message'
  readonly data: string
}

export type SocketCloseEvent = {
  readonly type: 'close'
  readonly code: number
  readonly reason: string
  readonly wasClean: boolean
}

type ServerSessionControl = Pick<
  FakeMarketDataServerSession,
  'receiveClientFrame' | 'close'
>

export type FakeMarketDataWebSocketOptions = {
  readonly url?: string
  readonly connectionDelayMs?: number
  readonly closeDelayMs?: number
  readonly serverOptions?: Omit<
    FakeMarketDataServerSessionOptions,
    'sendToClient'
  >
  readonly createServerSession?: (
    sendToClient: (message: ServerMessage) => void,
  ) => ServerSessionControl
}

/**
 * A testable subset of the browser WebSocket API.
 *
 * The transport owns connection state and wire serialization. Client protocol
 * and subscription state are delegated to FakeMarketDataServerSession.
 */
export class FakeMarketDataWebSocket {
  readonly url: string

  onopen: ((event: SocketOpenEvent) => void) | null = null
  onmessage: ((event: SocketMessageEvent) => void) | null = null
  onclose: ((event: SocketCloseEvent) => void) | null = null

  private state: WebSocketReadyStateValue = WebSocketReadyState.CONNECTING
  private readonly closeDelayMs: number
  private readonly serverSession: ServerSessionControl
  private connectionTimer: ReturnType<typeof setTimeout> | undefined
  private closeTimer: ReturnType<typeof setTimeout> | undefined

  constructor({
    url = 'ws://localhost/market-data',
    connectionDelayMs = 100,
    closeDelayMs = 0,
    serverOptions,
    createServerSession,
  }: FakeMarketDataWebSocketOptions = {}) {
    assertNonNegativeDelay(connectionDelayMs, 'connectionDelayMs')
    assertNonNegativeDelay(closeDelayMs, 'closeDelayMs')

    this.url = url
    this.closeDelayMs = closeDelayMs
    this.serverSession = createServerSession
      ? createServerSession((message) => this.deliverServerMessage(message))
      : new FakeMarketDataServerSession({
          ...serverOptions,
          sendToClient: (message) => this.deliverServerMessage(message),
        })

    this.connectionTimer = setTimeout(() => this.open(), connectionDelayMs)
  }

  get readyState(): WebSocketReadyStateValue {
    return this.state
  }

  /** Sends a raw client frame to the server-side protocol session. */
  send(data: string): void {
    if (this.state !== WebSocketReadyState.OPEN) {
      throw invalidStateError('Cannot send while the WebSocket is not open.')
    }
    this.serverSession.receiveClientFrame(data)
  }

  /** Starts a clean client-initiated close handshake. */
  close(code = 1000, reason = ''): void {
    if (
      this.state === WebSocketReadyState.CLOSING ||
      this.state === WebSocketReadyState.CLOSED
    ) {
      return
    }

    this.state = WebSocketReadyState.CLOSING
    this.clearConnectionTimer()
    this.serverSession.close()

    this.closeTimer = setTimeout(() => {
      this.finishClose({ code, reason, wasClean: true })
    }, this.closeDelayMs)
  }

  /** Simulates an unexpected server/network failure for future reconnect tests. */
  simulateServerDisconnect(reason = 'Simulated connection loss'): void {
    if (
      this.state === WebSocketReadyState.CLOSING ||
      this.state === WebSocketReadyState.CLOSED
    ) {
      return
    }

    this.clearConnectionTimer()
    this.serverSession.close()
    this.finishClose({ code: 1006, reason, wasClean: false })
  }

  private open(): void {
    this.connectionTimer = undefined
    if (this.state !== WebSocketReadyState.CONNECTING) return

    this.state = WebSocketReadyState.OPEN
    this.onopen?.({ type: 'open' })
  }

  private deliverServerMessage(message: ServerMessage): void {
    if (this.state !== WebSocketReadyState.OPEN) return
    this.onmessage?.({
      type: 'message',
      data: JSON.stringify(message),
    })
  }

  private finishClose({
    code,
    reason,
    wasClean,
  }: Omit<SocketCloseEvent, 'type'>): void {
    if (this.state === WebSocketReadyState.CLOSED) return

    this.state = WebSocketReadyState.CLOSED
    this.closeTimer = undefined
    this.onclose?.({ type: 'close', code, reason, wasClean })
  }

  private clearConnectionTimer(): void {
    if (this.connectionTimer !== undefined) {
      clearTimeout(this.connectionTimer)
      this.connectionTimer = undefined
    }
  }
}

function assertNonNegativeDelay(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number.`)
  }
}

function invalidStateError(message: string): Error {
  const error = new Error(message)
  error.name = 'InvalidStateError'
  return error
}
