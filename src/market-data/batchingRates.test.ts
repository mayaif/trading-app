import { describe, expect, it } from 'vitest'
import type { BatchingMetrics } from './MarketDataBatcher'
import {
  EMPTY_BATCHING_RATES,
  calculateBatchingRates,
} from './batchingRates'

const baseline: BatchingMetrics = {
  receivedMessages: 100,
  receivedSnapshots: 1,
  receivedPriceUpdates: 95,
  receivedHeartbeats: 4,
  flushChecks: 20,
  publishedBatches: 10,
  publishedRows: 40,
  coalescedPriceUpdates: 55,
}

describe('calculateBatchingRates', () => {
  it('turns cumulative counters into per-second rates', () => {
    const current: BatchingMetrics = {
      receivedMessages: 150,
      receivedSnapshots: 1,
      receivedPriceUpdates: 135,
      receivedHeartbeats: 14,
      flushChecks: 30,
      publishedBatches: 15,
      publishedRows: 50,
      coalescedPriceUpdates: 85,
    }

    expect(calculateBatchingRates(baseline, current, 500)).toEqual({
      messagesPerSecond: 100,
      priceUpdatesPerSecond: 80,
      batchesPerSecond: 10,
      rowsPerSecond: 20,
      coalescingRatio: 0.75,
    })
  })

  it('returns zero rates for an invalid sampling window', () => {
    expect(calculateBatchingRates(baseline, baseline, 0)).toBe(
      EMPTY_BATCHING_RATES,
    )
  })

  it('does not report negative rates if counters are reset', () => {
    const reset = Object.fromEntries(
      Object.keys(baseline).map((key) => [key, 0]),
    ) as BatchingMetrics

    expect(calculateBatchingRates(baseline, reset, 1_000)).toEqual(
      EMPTY_BATCHING_RATES,
    )
  })
})
