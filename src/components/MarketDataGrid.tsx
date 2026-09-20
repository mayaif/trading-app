import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  themeQuartz,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ValueFormatterParams,
} from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import type { MarketDataRow } from '../market-data/MarketDataStore'
import {
  marketDataRuntime,
  SIMULATION_LOAD_PROFILES,
  type SimulationLoadProfile,
} from '../market-data/MarketDataRuntime'
import { useBatchingRates } from '../market-data/useBatchingRates'
import {
  useMarketDataSnapshot,
  useSimulationLoadProfile,
} from '../market-data/useMarketData'
import { createGridTransaction } from './gridTransactions'

const EMPTY_ROWS: MarketDataRow[] = []

const marketGridTheme = themeQuartz.withParams({
  accentColor: '#2b9b77',
  backgroundColor: '#ffffff',
  borderColor: '#dfe4de',
  cellTextColor: '#27332e',
  fontFamily: '"DM Mono", monospace',
  fontSize: 11,
  headerBackgroundColor: '#f8faf7',
  headerFontSize: 9,
  headerTextColor: '#75837c',
  oddRowBackgroundColor: '#fbfcfa',
  rowBorder: { color: '#ecefeb' },
  spacing: 7,
  wrapperBorder: false,
})

export function MarketDataGrid() {
  const snapshot = useMarketDataSnapshot()
  const batchingRates = useBatchingRates()
  const loadProfile = useSimulationLoadProfile()
  const apiRef = useRef<GridApi<MarketDataRow> | null>(null)
  const rowsByKeyRef = useRef(new Map<string, MarketDataRow>())
  const appliedVersionRef = useRef(0)

  const columnDefs = useMemo<ColDef<MarketDataRow>[]>(
    () => [
      {
        field: 'venue',
        headerName: 'VENUE',
        flex: 1.35,
        minWidth: 135,
        valueFormatter: ({ value }) => String(value).replaceAll('_', ' '),
      },
      { field: 'bidSize', headerName: 'BID SIZE', valueFormatter: formatSize },
      { field: 'bidPrice', headerName: 'BID', valueFormatter: formatPrice },
      { field: 'askPrice', headerName: 'ASK', valueFormatter: formatPrice },
      { field: 'askSize', headerName: 'ASK SIZE', valueFormatter: formatSize },
      {
        colId: 'spread',
        headerName: 'SPREAD',
        valueGetter: ({ data }) =>
          data ? (data.askPrice - data.bidPrice) * 10_000 : undefined,
        valueFormatter: ({ value }) => Number(value).toFixed(1),
      },
      { field: 'sequence', headerName: 'SEQ', maxWidth: 90 },
    ],
    [],
  )

  const applySnapshot = useCallback(
    (api: GridApi<MarketDataRow>) => {
      if (!snapshot.initialized || snapshot.version === appliedVersionRef.current) {
        return
      }

      const transaction = createGridTransaction(
        snapshot,
        rowsByKeyRef.current,
        appliedVersionRef.current,
      )
      api.applyTransaction(transaction)
      appliedVersionRef.current = snapshot.version
    },
    [snapshot],
  )

  useEffect(() => {
    if (apiRef.current) applySnapshot(apiRef.current)
  }, [applySnapshot])

  const handleGridReady = useCallback(
    (event: GridReadyEvent<MarketDataRow>) => {
      apiRef.current = event.api
      applySnapshot(event.api)
    },
    [applySnapshot],
  )

  if (!snapshot.initialized) {
    return (
      <div className="placeholder market-waiting">
        <span className="pulse-dot" />
        <strong>Waiting for initial snapshot</strong>
        <p>The connection is preparing the first batched market view.</p>
      </div>
    )
  }

  return (
    <div className="market-grid">
      <div className="grid-meta">
        <span title="The latest immutable store publication">
          SNAPSHOT v{snapshot.version}
        </span>
        <span title="All accepted market-data messages, including heartbeats">
          {Math.round(batchingRates.messagesPerSecond)} MSG/S
        </span>
        <span title="Store publications sent to React and ag-Grid">
          {batchingRates.batchesPerSecond.toFixed(1)} BATCHES/S
        </span>
        <span title="Repeated updates collapsed before publication">
          {Math.round(batchingRates.coalescingRatio * 100)}% COALESCED
        </span>
        <div className="load-control" aria-label="Simulation load">
          {SIMULATION_LOAD_PROFILES.map((profile) => (
            <button
              className={profile.id === loadProfile ? 'load-active' : undefined}
              key={profile.id}
              type="button"
              title={`${profile.targetUpdatesPerSecond} target price updates per second`}
              aria-pressed={profile.id === loadProfile}
              onClick={() => selectLoadProfile(profile.id)}
            >
              {profile.label} {profile.targetUpdatesPerSecond}/s
            </button>
          ))}
        </div>
      </div>
      <div className="grid-body">
        <AgGridReact<MarketDataRow>
          theme={marketGridTheme}
          columnDefs={columnDefs}
          defaultColDef={{
            flex: 1,
            minWidth: 95,
            sortable: false,
            suppressMovable: true,
            resizable: true,
            enableCellChangeFlash: true,
          }}
          getRowId={({ data }) => data.key}
          rowData={EMPTY_ROWS}
          rowHeight={43}
          headerHeight={34}
          animateRows={false}
          suppressCellFocus
          onGridReady={handleGridReady}
        />
      </div>
    </div>
  )
}

function selectLoadProfile(profile: SimulationLoadProfile): void {
  marketDataRuntime.setLoadProfile(profile)
}

function formatPrice({ value }: ValueFormatterParams<MarketDataRow, number>): string {
  return value == null ? '' : value.toFixed(5)
}

function formatSize({ value }: ValueFormatterParams<MarketDataRow, number>): string {
  return value == null ? '' : `${(value / 1_000_000).toFixed(1)}m`
}
