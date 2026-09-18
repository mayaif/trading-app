export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <span>AURELIA</span>
          <span className="brand-product">FX</span>
        </div>
        <span className="environment">SIMULATION</span>
        <span className="connection">NOT CONNECTED</span>
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
            <Placeholder number="01" title="Price table" description="The simulated WebSocket prices will appear here." />
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
