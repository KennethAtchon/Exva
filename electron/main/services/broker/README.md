# broker

Broker integration — order routing, balances, instrument normalization, mock/paper adapters.

## Technical

- `broker-registry.ts` maps session → adapter (Alpaca, Coinbase, Tradovate, Polymarket, mock).
