# 2026-04-09 Weapp Server Fallback Archive

This archive preserves the Taro generation chain before switching to pure local
WASM generation.

Archived behavior:

- Weapp generation first attempted local WASM.
- On local failure, generation silently fell back to `/api/generate`.
- The Weapp runtime downloaded the WASM binary from the backend and cached it
  in user storage.

Snapshot files:

- `local-generation.ts.snapshot`
- `pattern-service.ts.snapshot`
- `env.ts.snapshot`
