import { FakeMarketDataWebSocket } from './FakeMarketDataWebSocket'
import {
  MarketDataBatcher,
  type BatchingMetrics,
} from './MarketDataBatcher'
import {
  MarketDataConnection,
  type ConnectionStatus,
  type MarketDataConnectionOptions,
  type MarketDataSocket,
} from './MarketDataConnection'
import { MarketDataStore } from './MarketDataStore'

type StatusListener = () => void

export type MarketDataRuntimeOptions = {
  readonly createSocket?: () => MarketDataSocket
  readonly flushIntervalMs?: number
  readonly connectionOptions?: Omit<
    MarketDataConnectionOptions,
    'createSocket' | 'onStatusChange' | 'onMarketData'
  >
}

/** Owns the non-React market-data pipeline and exposes subscribable state. */
export class MarketDataRuntime {
  readonly store = new MarketDataStore()

  private readonly createSocket: () => MarketDataSocket
  private readonly connectionOptions: MarketDataRuntimeOptions['connectionOptions']
  private readonly batcher: MarketDataBatcher
  private readonly statusListeners = new Set<StatusListener>()
  private connection: MarketDataConnection | undefined
  private currentStatus: ConnectionStatus = 'disconnected'
  private generation = 0

  constructor({
    createSocket = () => new FakeMarketDataWebSocket(),
    flushIntervalMs = 100,
    connectionOptions,
  }: MarketDataRuntimeOptions = {}) {
    this.createSocket = createSocket
    this.connectionOptions = connectionOptions
    this.batcher = new MarketDataBatcher({
      store: this.store,
      flushIntervalMs,
    })
  }

  getStatusSnapshot = (): ConnectionStatus => this.currentStatus

  subscribeToStatus = (listener: StatusListener): (() => void) => {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  getBatchingMetrics(): BatchingMetrics {
    return this.batcher.getMetrics()
  }

  start(): void {
    if (this.connection) return

    const generation = ++this.generation
    this.batcher.start()
    const connection = new MarketDataConnection({
      ...this.connectionOptions,
      createSocket: this.createSocket,
      onStatusChange: (status) => {
        if (generation === this.generation) this.setStatus(status)
      },
      onMarketData: (message) => {
        if (generation === this.generation) this.batcher.ingest(message)
      },
    })
    this.connection = connection
    connection.connect()
  }

  stop(): void {
    if (!this.connection) return

    // Invalidate callbacks before initiating the asynchronous socket close.
    this.generation += 1
    const connection = this.connection
    this.connection = undefined
    this.batcher.stop()
    connection.disconnect()
    this.setStatus('disconnected')
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.currentStatus) return
    this.currentStatus = status
    this.statusListeners.forEach((listener) => listener())
  }
}

export const marketDataRuntime = new MarketDataRuntime()
