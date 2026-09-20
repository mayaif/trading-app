import type { BatchingMetrics } from './MarketDataBatcher'

export type BatchingRates = Readonly<{
  messagesPerSecond: number
  priceUpdatesPerSecond: number
  batchesPerSecond: number
  rowsPerSecond: number
  coalescingRatio: number
}>

export const EMPTY_BATCHING_RATES: BatchingRates = {
  messagesPerSecond: 0,
  priceUpdatesPerSecond: 0,
  batchesPerSecond: 0,
  rowsPerSecond: 0,
  coalescingRatio: 0,
}

/** Converts two cumulative counter readings into rates for one sample window. */
export function calculateBatchingRates(
  previous: BatchingMetrics,
  current: BatchingMetrics,
  elapsedMs: number,
): BatchingRates {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return EMPTY_BATCHING_RATES
  }

  const elapsedSeconds = elapsedMs / 1_000
  const priceUpdates = delta(current.receivedPriceUpdates, previous.receivedPriceUpdates)
  const coalescedUpdates = delta(
    current.coalescedPriceUpdates,
    previous.coalescedPriceUpdates,
  )

  return {
    messagesPerSecond:
      delta(current.receivedMessages, previous.receivedMessages) / elapsedSeconds,
    priceUpdatesPerSecond: priceUpdates / elapsedSeconds,
    batchesPerSecond:
      delta(current.publishedBatches, previous.publishedBatches) / elapsedSeconds,
    rowsPerSecond:
      delta(current.publishedRows, previous.publishedRows) / elapsedSeconds,
    coalescingRatio: priceUpdates === 0 ? 0 : coalescedUpdates / priceUpdates,
  }
}

function delta(current: number, previous: number): number {
  return Math.max(0, current - previous)
}
