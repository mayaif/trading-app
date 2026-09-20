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
type LoadProfileListener = () => void

export type SimulationLoadProfile = 'normal' | 'fast' | 'stress'

export const SIMULATION_LOAD_PROFILES: ReadonlyArray<{
  readonly id: SimulationLoadProfile
  readonly label: string
  readonly targetUpdatesPerSecond: number
}> = [
  { id: 'normal', label: 'Normal', targetUpdatesPerSecond: 20 },
  { id: 'fast', label: 'Fast', targetUpdatesPerSecond: 100 },
  { id: 'stress', label: 'Stress', targetUpdatesPerSecond: 1_000 },
]

export type MarketDataRuntimeOptions = {
  readonly createSocket?: (loadProfile: SimulationLoadProfile) => MarketDataSocket
  readonly initialLoadProfile?: SimulationLoadProfile
  readonly flushIntervalMs?: number
  readonly connectionOptions?: Omit<
    MarketDataConnectionOptions,
    'createSocket' | 'onStatusChange' | 'onMarketData'
  >
}

/** Owns the non-React market-data pipeline and exposes subscribable state. */
export class MarketDataRuntime {
  readonly store = new MarketDataStore()

  private readonly createSocket: (
    loadProfile: SimulationLoadProfile,
  ) => MarketDataSocket
  private readonly connectionOptions: MarketDataRuntimeOptions['connectionOptions']
  private readonly batcher: MarketDataBatcher
  private readonly statusListeners = new Set<StatusListener>()
  private readonly loadProfileListeners = new Set<LoadProfileListener>()
  private connection: MarketDataConnection | undefined
  private currentStatus: ConnectionStatus = 'disconnected'
  private currentLoadProfile: SimulationLoadProfile
  private generation = 0

  constructor({
    createSocket,
    initialLoadProfile = 'normal',
    flushIntervalMs = 100,
    connectionOptions,
  }: MarketDataRuntimeOptions = {}) {
    this.createSocket =
      createSocket ??
      ((loadProfile) =>
        new FakeMarketDataWebSocket({
          serverOptions: {
            simulatorOptions: {
              priceIntervalMs: getPriceIntervalMs(loadProfile),
            },
          },
        }))
    this.currentLoadProfile = initialLoadProfile
    this.connectionOptions = connectionOptions
    this.batcher = new MarketDataBatcher({
      store: this.store,
      flushIntervalMs,
    })
  }

  getStatusSnapshot = (): ConnectionStatus => this.currentStatus

  getLoadProfileSnapshot = (): SimulationLoadProfile => this.currentLoadProfile

  subscribeToStatus = (listener: StatusListener): (() => void) => {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  subscribeToLoadProfile = (listener: LoadProfileListener): (() => void) => {
    this.loadProfileListeners.add(listener)
    return () => {
      this.loadProfileListeners.delete(listener)
    }
  }

  /** Restarts only the fake feed so its timer can use the new load setting. */
  setLoadProfile(profile: SimulationLoadProfile): void {
    if (profile === this.currentLoadProfile) return

    this.currentLoadProfile = profile
    this.loadProfileListeners.forEach((listener) => listener())

    if (this.connection) {
      this.stop()
      this.start()
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
      createSocket: () => this.createSocket(this.currentLoadProfile),
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

function getPriceIntervalMs(profile: SimulationLoadProfile): number {
  const selectedProfile = SIMULATION_LOAD_PROFILES.find(
    ({ id }) => id === profile,
  )
  if (!selectedProfile) throw new Error(`Unknown simulation load profile: ${profile}`)
  return 1_000 / selectedProfile.targetUpdatesPerSecond
}
