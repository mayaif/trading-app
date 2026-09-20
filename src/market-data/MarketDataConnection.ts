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

export type MarketDataConnectionOptions = {
  readonly createSocket: () => MarketDataSocket
  readonly instruments?: readonly CurrencyPair[]
  readonly createRequestId?: () => string
  readonly onStatusChange?: (status: ConnectionStatus) => void
  readonly onMarketData?: (message: MarketDataMessage) => void
  readonly onProcessingResult?: (result: ProcessingResult) => void
  readonly onIssue?: (issue: ConnectionIssue) => void
}

/**
 * Owns one client-side connection attempt from socket creation through clean
 * shutdown. Reconnect and stale-data timers are intentionally added later.
 */
export class MarketDataConnection {
  private readonly createSocket: () => MarketDataSocket
  private readonly instruments: readonly CurrencyPair[]
  private readonly createRequestId: () => string
  private readonly onStatusChange: (status: ConnectionStatus) => void
  private readonly onMarketData: (message: MarketDataMessage) => void
  private readonly onProcessingResult: (result: ProcessingResult) => void
  private readonly onIssue: (issue: ConnectionIssue) => void

  private currentStatus: ConnectionStatus = 'disconnected'
  private socket: MarketDataSocket | undefined
  private processor: MarketDataStreamProcessor | undefined

  constructor({
    createSocket,
    instruments = ['EUR/USD'],
    createRequestId = () => `request-${crypto.randomUUID()}`,
    onStatusChange = () => undefined,
    onMarketData = () => undefined,
    onProcessingResult = () => undefined,
    onIssue = () => undefined,
  }: MarketDataConnectionOptions) {
    if (instruments.length === 0) {
      throw new TypeError('At least one instrument must be requested.')
    }

    this.createSocket = createSocket
    this.instruments = [...instruments]
    this.createRequestId = createRequestId
    this.onStatusChange = onStatusChange
    this.onMarketData = onMarketData
    this.onProcessingResult = onProcessingResult
    this.onIssue = onIssue
  }

  get status(): ConnectionStatus {
    return this.currentStatus
  }

  connect(): void {
    if (this.currentStatus !== 'disconnected') return

    const requestId = this.createRequestId()
    this.processor = new MarketDataStreamProcessor(requestId)
    this.setStatus('connecting')

    const socket = this.createSocket()
    this.socket = socket
    socket.onopen = () => this.handleOpen(socket, requestId)
    socket.onmessage = (event) => this.handleMessage(socket, event.data)
    socket.onclose = () => this.handleClose(socket)
  }

  disconnect(): void {
    if (!this.socket || this.currentStatus === 'disconnected') return
    if (this.currentStatus === 'disconnecting') return

    this.setStatus('disconnecting')
    this.socket.close(1000, 'Client disconnect')
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
      socket.close(1011, 'Subscription send failed')
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
      if (result.status === 'gap') this.setStatus('out_of_sync')
      return
    }

    if (result.message.type === 'subscription_ack') {
      this.setStatus('awaiting_snapshot')
      return
    }

    if (result.message.type === 'price_snapshot') {
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
    this.setStatus('disconnected')
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.currentStatus) return
    this.currentStatus = status
    this.onStatusChange(status)
  }
}
