import { useEffect, useRef, useState } from 'react'
import { marketDataRuntime } from './MarketDataRuntime'
import type { BatchingMetrics } from './MarketDataBatcher'
import {
  EMPTY_BATCHING_RATES,
  calculateBatchingRates,
  type BatchingRates,
} from './batchingRates'

type MetricsSample = {
  readonly sampledAt: number
  readonly metrics: BatchingMetrics
}

const SAMPLE_INTERVAL_MS = 1_000

/** Samples cumulative batching counters without adding work to every tick. */
export function useBatchingRates(): BatchingRates {
  const previousSampleRef = useRef<MetricsSample | null>(null)
  const [rates, setRates] = useState(EMPTY_BATCHING_RATES)

  useEffect(() => {
    previousSampleRef.current = takeSample()

    const timer = setInterval(() => {
      const currentSample = takeSample()
      const previousSample = previousSampleRef.current
      previousSampleRef.current = currentSample

      if (!previousSample) return
      setRates(
        calculateBatchingRates(
          previousSample.metrics,
          currentSample.metrics,
          currentSample.sampledAt - previousSample.sampledAt,
        ),
      )
    }, SAMPLE_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [])

  return rates
}

function takeSample(): MetricsSample {
  return {
    sampledAt: performance.now(),
    metrics: marketDataRuntime.getBatchingMetrics(),
  }
}
