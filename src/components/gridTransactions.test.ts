import { describe, expect, it } from 'vitest'
import type { MarketDataRow, MarketDataStoreSnapshot } from '../market-data/MarketDataStore'
import { createGridTransaction } from './gridTransactions'

const citiRow = row('CITI', 1, 1.08472)
const jpmRow = row('JPMORGAN', 1, 1.0847)

describe('createGridTransaction', () => {
  it('adds the complete current view when the grid first starts', () => {
    const knownRows = new Map<string, MarketDataRow>()
    const transaction = createGridTransaction(
      snapshot(3, [citiRow, jpmRow], [jpmRow]),
      knownRows,
      0,
    )

    expect(transaction.add).toEqual([citiRow, jpmRow])
    expect(transaction.update).toEqual([])
    expect(knownRows.size).toBe(2)
  })

  it('updates only the rows changed in the next publication', () => {
    const nextCitiRow = row('CITI', 2, 1.08473)
    const knownRows = new Map([
      [citiRow.key, citiRow],
      [jpmRow.key, jpmRow],
    ])

    const transaction = createGridTransaction(
      snapshot(2, [nextCitiRow, jpmRow], [nextCitiRow]),
      knownRows,
      1,
    )

    expect(transaction).toEqual({ add: [], update: [nextCitiRow], remove: [] })
    expect(knownRows.get(citiRow.key)).toBe(nextCitiRow)
  })

  it('removes rows omitted by a replacement snapshot', () => {
    const knownRows = new Map([
      [citiRow.key, citiRow],
      [jpmRow.key, jpmRow],
    ])

    const transaction = createGridTransaction(
      snapshot(2, [citiRow], [citiRow], [jpmRow.key]),
      knownRows,
      1,
    )

    expect(transaction.remove).toEqual([jpmRow])
    expect(knownRows.has(jpmRow.key)).toBe(false)
  })

  it('reconciles the full view if React skipped an intermediate version', () => {
    const nextCitiRow = row('CITI', 4, 1.08475)
    const knownRows = new Map([
      [citiRow.key, citiRow],
      [jpmRow.key, jpmRow],
    ])

    const transaction = createGridTransaction(
      snapshot(4, [nextCitiRow], [nextCitiRow], [jpmRow.key]),
      knownRows,
      1,
    )

    expect(transaction).toEqual({
      add: [],
      update: [nextCitiRow],
      remove: [jpmRow],
    })
  })
})

function snapshot(
  version: number,
  rows: readonly MarketDataRow[],
  changedRows: readonly MarketDataRow[],
  removedKeys: readonly string[] = [],
): MarketDataStoreSnapshot {
  return { version, initialized: true, rows, changedRows, removedKeys }
}

function row(
  venue: MarketDataRow['venue'],
  sequence: number,
  bidPrice: number,
): MarketDataRow {
  return {
    key: `EUR/USD:${venue}`,
    instrument: 'EUR/USD',
    venue,
    bidPrice,
    bidSize: 1_000_000,
    askPrice: bidPrice + 0.00008,
    askSize: 1_000_000,
    tradable: true,
    streamId: 'stream-test',
    sequence,
    receivedAt: 100,
  }
}
