# Aurelia FX demo

Step 1 contains the application backbone for a simulated electronic-trading frontend. It deliberately has no streaming, pricing, order, or reconnect logic yet.

## Run

```bash
npm install
npm run dev
```

Run the automated checks with:

```bash
npm test
```

## Current structure

- A top-level application shell
- A market-data placeholder
- An order-ticket placeholder
- An order-blotter placeholder

The market-data protocol is being defined before the fake WebSocket transport.

## Price-message contract

The wire format is defined in `src/market-data/types.ts`. The current
server-to-client protocol is a discriminated union containing:

- a complete price snapshot when a stream begins or recovers;
- incremental, per-venue price updates after that snapshot;
- heartbeats during periods with no price changes.

Every message carries a schema version, stream ID, per-stream sequence number,
and server timestamp. Quote data includes its instrument, venue, bid and ask
levels, available base-currency size, and whether it is tradeable.

Runtime validation of untrusted WebSocket data lives in
`src/market-data/decodeMarketDataMessage.ts`. The decoder distinguishes
malformed JSON from valid JSON that violates the market-data contract, and
returns a result rather than throwing into the stream handler.
