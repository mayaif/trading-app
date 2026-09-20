import type { RowDataTransaction } from 'ag-grid-community'
import type {
  MarketDataRow,
  MarketDataStoreSnapshot,
} from '../market-data/MarketDataStore'

/**
 * Converts a published store snapshot into the smallest safe ag-Grid update.
 *
 * The map is deliberately kept outside React state. It is the grid adapter's
 * index of rows already handed to ag-Grid, not application state.
 */
export function createGridTransaction(
  snapshot: MarketDataStoreSnapshot,
  rowsByKey: Map<string, MarketDataRow>,
  previousVersion: number,
): RowDataTransaction<MarketDataRow> {
  if (previousVersion === 0 || snapshot.version !== previousVersion + 1) {
    return reconcileFullSnapshot(snapshot.rows, rowsByKey)
  }

  const add: MarketDataRow[] = []
  const update: MarketDataRow[] = []
  const remove: MarketDataRow[] = []

  for (const key of snapshot.removedKeys) {
    const row = rowsByKey.get(key)
    if (row) remove.push(row)
    rowsByKey.delete(key)
  }

  for (const row of snapshot.changedRows) {
    if (rowsByKey.has(row.key)) update.push(row)
    else add.push(row)
    rowsByKey.set(row.key, row)
  }

  return { add, update, remove }
}

function reconcileFullSnapshot(
  rows: readonly MarketDataRow[],
  rowsByKey: Map<string, MarketDataRow>,
): RowDataTransaction<MarketDataRow> {
  const add: MarketDataRow[] = []
  const update: MarketDataRow[] = []
  const remove: MarketDataRow[] = []
  const currentKeys = new Set(rows.map((row) => row.key))

  for (const [key, existingRow] of rowsByKey) {
    if (!currentKeys.has(key)) {
      remove.push(existingRow)
      rowsByKey.delete(key)
    }
  }

  for (const row of rows) {
    const existingRow = rowsByKey.get(row.key)
    if (!existingRow) add.push(row)
    else if (existingRow !== row) update.push(row)
    rowsByKey.set(row.key, row)
  }

  return { add, update, remove }
}
