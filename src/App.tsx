import { useRef } from 'react'
import type { ConnectionStatus } from './market-data/MarketDataConnection'
import {
  useConnectionStatus,
  useMarketDataLifecycle,
  useMarketDataSnapshot,
} from './market-data/useMarketData'

export default function App() {
  useMarketDataLifecycle()
  const connectionStatus = useConnectionStatus()

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <span>AURELIA</span>
          <span className="brand-product">FX</span>
        </div>
        <span className="environment">SIMULATION</span>
        <span className={`connection connection-${connectionStatus}`}>
          {formatStatus(connectionStatus)}
        </span>
      </header>

      <main>
        <div className="workspace-title">
          <div>
            <span className="eyebrow">MARKET WORKSPACE / G10</span>
            <h1>EUR/USD <small>Euro / US Dollar</small></h1>
          </div>
          <span className="step-label">STEP 1 · APPLICATION SHELL</span>
        </div>

        <div className="trading-layout">
          <section className="panel market-data-panel">
            <div className="panel-heading"><span className="eyebrow">MARKET DATA</span><h2>EUR/USD price stream</h2></div>
            <MarketDataPreview />
          </section>

          <section className="panel order-panel">
            <div className="panel-heading"><span className="eyebrow">ORDER ENTRY</span><h2>Order ticket</h2></div>
            <Placeholder number="02" title="Execution controls" description="Buy, sell and notional controls will be added later." />
          </section>
        </div>

        <section className="panel blotter-panel">
          <div className="panel-heading"><span className="eyebrow">ORDERS</span><h2>Order blotter</h2></div>
          <Placeholder number="03" title="Execution history" description="Simulated fills and rejected orders will appear here." />
        </section>
      </main>

      <footer><span>DEMO ONLY · NOT FOR TRADING</span><span>React + TypeScript</span></footer>
    </div>
  )
}

function MarketDataPreview() {
  const snapshot = useMarketDataSnapshot()
  const renderCount = useRef(0)
  renderCount.current += 1

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
    <div className="price-preview">
      <div className="preview-meta">
        <span>SNAPSHOT v{snapshot.version}</span>
        <span>{snapshot.changedRows.length} ROWS CHANGED</span>
        <span>{renderCount.current} COMPONENT RENDERS</span>
      </div>
      <div className="preview-row preview-header">
        <span>VENUE</span><span>BID</span><span>ASK</span><span>SPREAD</span><span>SEQ</span>
      </div>
      {snapshot.rows.map((row) => (
        <div className="preview-row" key={row.key}>
          <strong>{formatVenue(row.venue)}</strong>
          <span>{row.bidPrice.toFixed(5)}</span>
          <span>{row.askPrice.toFixed(5)}</span>
          <span>{((row.askPrice - row.bidPrice) * 10_000).toFixed(1)}</span>
          <small>{row.sequence}</small>
        </div>
      ))}
    </div>
  )
}

function formatStatus(status: ConnectionStatus): string {
  return status.replaceAll('_', ' ').toUpperCase()
}

function formatVenue(venue: string): string {
  return venue.replaceAll('_', ' ')
}

type PlaceholderProps = { number: string; title: string; description: string }

function Placeholder({ number, title, description }: PlaceholderProps) {
  return (
    <div className="placeholder">
      <span className="placeholder-number">{number}</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  )
}
