# broker/adapters

Contains one implementation per live broker. Each adapter hides the broker-specific API quirks so the rest of Exva can place orders, fetch balances, and read market data through one contract.

## Technical

- `broker-adapter.ts` defines the shared interface.
- Concrete adapters cover Alpaca, Coinbase Advanced Trade, Tradovate, and Polymarket.
- Adapter resolution happens through the broker registry and routing services.

## Terms

- **Broker adapter** — broker-specific implementation of the common trading/data contract.
