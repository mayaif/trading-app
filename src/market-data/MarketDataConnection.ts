import { decodeServerMessage } from './decodeServerMessage'
import type {
  SocketCloseEvent,
  SocketMessageEvent,
  SocketOpenEvent,
} from './FakeMarketDataWebSocket'
import {
  MarketDataStreamProcessor,
  type ProcessingResult,
} from './MarketDataStreamProcessor'
import type {
  CurrencyPair,
  MarketDataMessage,
  SubscribeMessage,
} from './types'

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'subscribing'
  | 'awaiting_snapshot'
  | 'live'
  | 'out_of_sync'
  | 'reconnecting'
  | 'disconnecting'

/** The subset shared by our fake socket and a future real WebSocket adapter. */
export type MarketDataSocket = {
  onopen: ((event: SocketOpenEvent) => void) | null
  onmessage: ((event: SocketMessageEvent) => void) | null
  onclose: ((event: SocketCloseEvent) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type ConnectionIssue =
  | {
      readonly type: 'decode_error'
      readonly reason: 'invalid_json' | 'invalid_message'
      readonly error: string
    }
  | {
      readonly type: 'processing_result'
      readonly result: Exclude<ProcessingResult, { status: 'accepted' }>
    }
  | {
      readonly type: 'send_error'
      readonly error: unknown
    }
  | {
      readonly type: 'connection_error'
      readonly error: unknown
    }

export type ReconnectSchedule = {
  readonly attempt: number
  readonly delayMs: number
}

export type MarketDataConnectionOptions = {
  readonly createSocket: () => MarketDataSocket
  readonly instruments?: readonly CurrencyPair[]
  readonly createRequestId?: () => string
  readonly reconnectBaseDelayMs?: number
  readonly reconnectMaxDelayMs?: number
  readonly reconnectJitterRatio?: number
  readonly random?: () => number
  readonly onStatusChange?: (status: ConnectionStatus) => void
  readonly onMarketData?: (message: MarketDataMessage) => void
  readonly onProcessingResult?: (result: ProcessingResult) => void
  readonly onIssue?: (issue: ConnectionIssue) => void
  readonly onReconnectScheduled?: (schedule: ReconnectSchedule) => void
}

/**
 * Owns the client-side socket, subscription and automatic reconnection cycle.
 * Stale-data timers are intentionally added later.
 */
export class MarketDataConnection {
  private readonly createSocket: () => MarketDataSocket
  private readonly instruments: readonly CurrencyPair[]
  private readonly createRequestId: () => string
  private readonly reconnectBaseDelayMs: number
  private readonly reconnectMaxDelayMs: number
  private readonly reconnectJitterRatio: number
  private readonly random: () => number
  private readonly onStatusChange: (status: ConnectionStatus) => void
  private readonly onMarketData: (message: MarketDataMessage) => void
  private readonly onProcessingResult: (result: ProcessingResult) => void
  private readonly onIssue: (issue: ConnectionIssue) => void
  private readonly onReconnectScheduled: (schedule: ReconnectSchedule) => void

  private currentStatus: ConnectionStatus = 'disconnected'
  private socket: MarketDataSocket | undefined
  private processor: MarketDataStreamProcessor | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private reconnectAttempt = 0
  private disconnectRequested = false

  constructor({
    createSocket,
    instruments = ['EUR/USD'],
    createRequestId = () => `request-${crypto.randomUUID()}`,
    reconnectBaseDelayMs = 250,
    reconnectMaxDelayMs = 5_000,
    reconnectJitterRatio = 0.2,
    random = Math.random,
    onStatusChange = () => undefined,
    onMarketData = () => undefined,
    onProcessingResult = () => undefined,
    onIssue = () => undefined,
    onReconnectScheduled = () => undefined,
  }: MarketDataConnectionOptions) {
    if (instruments.length === 0) {
      throw new TypeError('At least one instrument must be requested.')
    }
    assertPositiveDelay(reconnectBaseDelayMs, 'reconnectBaseDelayMs')
    assertPositiveDelay(reconnectMaxDelayMs, 'reconnectMaxDelayMs')
    if (reconnectMaxDelayMs < reconnectBaseDelayMs) {
      throw new RangeError('reconnectMaxDelayMs must be at least reconnectBaseDelayMs.')
    }
    if (
      !Number.isFinite(reconnectJitterRatio) ||
      reconnectJitterRatio < 0 ||
      reconnectJitterRatio > 1
    ) {
      throw new RangeError('reconnectJitterRatio must be between 0 and 1.')
    }

    this.createSocket = createSocket
    this.instruments = [...instruments]
    this.createRequestId = createRequestId
    this.reconnectBaseDelayMs = reconnectBaseDelayMs
    this.reconnectMaxDelayMs = reconnectMaxDelayMs
    this.reconnectJitterRatio = reconnectJitterRatio
    this.random = random
    this.onStatusChange = onStatusChange
    this.onMarketData = onMarketData
    this.onProcessingResult = onProcessingResult
    this.onIssue = onIssue
    this.onReconnectScheduled = onReconnectScheduled
  }

  get status(): ConnectionStatus {
    return this.currentStatus
  }

  get retryAttempt(): number {
    return this.reconnectAttempt
  }

  connect(): void {
    if (this.currentStatus !== 'disconnected') return

    this.disconnectRequested = false
    this.reconnectAttempt = 0
    this.startConnectionAttempt()
  }

  disconnect(): void {
    this.disconnectRequested = true
    this.clearReconnectTimer()
    if (this.currentStatus === 'disconnected') return
    if (this.currentStatus === 'disconnecting') return

    if (!this.socket) {
      this.processor = undefined
      this.reconnectAttempt = 0
      this.setStatus('disconnected')
      return
    }

    this.setStatus('disconnecting')
    this.socket.close(1000, 'Client disconnect')
  }

  private startConnectionAttempt(): void {
    if (this.disconnectRequested) return

    this.setStatus('connecting')

    try {
      const requestId = this.createRequestId()
      this.processor = new MarketDataStreamProcessor(requestId)
      const socket = this.createSocket()
      this.socket = socket
      socket.onopen = () => this.handleOpen(socket, requestId)
      socket.onmessage = (event) => this.handleMessage(socket, event.data)
      socket.onclose = () => this.handleClose(socket)
    } catch (error) {
      this.socket = undefined
      this.processor = undefined
      this.onIssue({ type: 'connection_error', error })
      this.scheduleReconnect()
    }
  }

  private handleOpen(socket: MarketDataSocket, requestId: string): void {
    if (socket !== this.socket || this.currentStatus !== 'connecting') return

    this.setStatus('subscribing')
    const subscription: SubscribeMessage = {
      type: 'subscribe',
      schemaVersion: 1,
      requestId,
      instruments: this.instruments,
    }

    try {
      socket.send(JSON.stringify(subscription))
    } catch (error) {
      this.onIssue({ type: 'send_error', error })
      socket.close(4002, 'Subscription send failed')
    }
  }

  private handleMessage(socket: MarketDataSocket, rawMessage: string): void {
    if (socket !== this.socket || !this.processor) return

    const decoded = decodeServerMessage(rawMessage)
    if (!decoded.ok) {
      this.onIssue({
        type: 'decode_error',
        reason: decoded.reason,
        error: decoded.error,
      })
      return
    }

    const result = this.processor.process(decoded.message)
    this.onProcessingResult(result)

    if (result.status !== 'accepted') {
      this.onIssue({ type: 'processing_result', result })
      if (result.status === 'gap') {
        this.setStatus('out_of_sync')
        socket.close(4001, 'Market data sequence gap')
      }
      return
    }

    if (result.message.type === 'subscription_ack') {
      this.setStatus('awaiting_snapshot')
      return
    }

    if (result.message.type === 'price_snapshot') {
      this.reconnectAttempt = 0
      this.setStatus('live')
    }
    this.onMarketData(result.message)
  }

  private handleClose(socket: MarketDataSocket): void {
    if (socket !== this.socket) return

    socket.onopen = null
    socket.onmessage = null
    socket.onclose = null
    this.socket = undefined
    this.processor = undefined

    if (this.disconnectRequested) {
      this.reconnectAttempt = 0
      this.setStatus('disconnected')
      return
    }

    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.disconnectRequested || this.reconnectTimer !== undefined) return

    this.reconnectAttempt += 1
    const delayMs = this.calculateReconnectDelay(this.reconnectAttempt)
    this.setStatus('reconnecting')
    this.onReconnectScheduled({ attempt: this.reconnectAttempt, delayMs })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.startConnectionAttempt()
    }, delayMs)
  }

  private calculateReconnectDelay(attempt: number): number {
    const exponentialDelay = Math.min(
      this.reconnectBaseDelayMs * 2 ** Math.min(attempt - 1, 30),
      this.reconnectMaxDelayMs,
    )
    const sample = this.random()
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError('The random source must return values in [0, 1).')
    }
    const jitter = exponentialDelay * this.reconnectJitterRatio * (sample * 2 - 1)
    return Math.min(this.reconnectMaxDelayMs, Math.max(0, Math.round(exponentialDelay + jitter)))
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === undefined) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.currentStatus) return
    this.currentStatus = status
    this.onStatusChange(status)
  }
}

function assertPositiveDelay(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`)
  }
}
