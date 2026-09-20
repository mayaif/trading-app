import { useEffect, useSyncExternalStore } from 'react'
import { marketDataRuntime } from './MarketDataRuntime'

export function useMarketDataLifecycle(): void {
  useEffect(() => {
    marketDataRuntime.start()
    return () => marketDataRuntime.stop()
  }, [])
}

export function useConnectionStatus() {
  return useSyncExternalStore(
    marketDataRuntime.subscribeToStatus,
    marketDataRuntime.getStatusSnapshot,
    marketDataRuntime.getStatusSnapshot,
  )
}

export function useSimulationLoadProfile() {
  return useSyncExternalStore(
    marketDataRuntime.subscribeToLoadProfile,
    marketDataRuntime.getLoadProfileSnapshot,
    marketDataRuntime.getLoadProfileSnapshot,
  )
}

export function useMarketDataSnapshot() {
  return useSyncExternalStore(
    marketDataRuntime.store.subscribe,
    marketDataRuntime.store.getSnapshot,
    marketDataRuntime.store.getSnapshot,
  )
}
