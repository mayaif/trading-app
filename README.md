# Aurelia FX demo

Step 1 contains the application backbone for a simulated electronic-trading frontend. It deliberately has no streaming, pricing, order, or reconnect logic yet.

## Run

```bash
npm install
npm run dev
```

## Current structure

- A top-level application shell
- A market-data placeholder
- An order-ticket placeholder
- An order-blotter placeholder

The next approved step will introduce the fake WebSocket transport and define the price-message contract.
