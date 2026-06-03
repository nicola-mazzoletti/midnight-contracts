# AGENTS.md

Guidance for AI coding agents working in this repository. Read this before
making changes. Prefer verifying claims against the code over trusting prose,
including this file.

## What this repo is

`@eddalabs/example-contracts` is a lightweight, contract-focused catalog of
[Compact](https://docs.midnight.network) smart contracts for
[Midnight](https://midnight.network). It is deliberately **not** a full dApp:
there is no UI and no CLI. The focus is the contracts and their tests, so a
reader can clone, read, run the tests, and start modifying without standing up
any infrastructure.

It is a Turbo monorepo of independent contract workspaces. Current contracts:

- `counter-contract`: minimal public state, no privacy (start here).
- `bulletin-board-contract`: witnesses and selective disclosure.
- `minting-zswap-contract`: token minting (pending a currency-model cleanup; treat as out of date).

License: Apache-2.0.

## The five-part workspace pattern

Every contract workspace follows the same shape. New contracts should match it:

```
src/<name>.compact          → the contract source (the only thing you hand-write here)
  ↓ compact compile
src/managed/<name>/         → GENERATED: TS API, ZK keys, circuit IR (do not edit, do not commit)
src/witnesses.ts            → private-state type + witness implementations
src/test/simulators/        → in-memory CircuitContext harness (phase-1, no infra)
src/test/<name>.test.ts     → Vitest suite
docs.md                     → beginner walkthrough (see template note below)
```

## Build and test

Per workspace:

```bash
npm run compact      # compile <name>.compact into src/managed/<name>/
npm run compact-fast # same, but --skip-zk (faster; use while iterating on logic)
npm test             # vitest run, entirely in memory
```

From the repo root, `npm run build` / `npm run compact` / `npm run lint` fan out
across workspaces via Turbo. Tests need **no** node, wallet, or proof server;
the simulators run circuits in-memory using `@midnight-ntwrk/compact-runtime`.

## Conventions that bite

- **Compiler toolchain is `+0.31.0`.** That is the version pinned in each
  workspace's `compact` script. Do not assume older versions; verify with
  `compact` against the available list. (Language pragmas in-tree are currently
  `>= 0.19` and `>= 0.23`; the `0.31.0` compiler accepts both.)
- **Never commit `src/managed/`.** It is generated build output, gitignored via
  `**/managed/`. Readers regenerate it with `npm run compact`. Committing it
  invites staleness and toolchain mismatch.
- **On-chain integers are `bigint`.** Assertions compare against `0n`, `1n`,
  etc. Mixing `0` and `0n` is a common mistake.
- **`disclose` is required on ledger writes of private values, not on asserts.**
  Writing a witness-derived value (or a circuit parameter, which is private by
  default) into the ledger needs `disclose(...)`; the compiler error is "a
  ledger operation might disclose the witness value." Asserting on a private
  value, even a witness-derived comparison, does not require it. Verify before
  claiming otherwise.
- **Keep workspaces clean.** Do not leave session transcripts, scratch notes, or
  agent work-logs in a workspace. Intentional documentation goes in `docs.md`.

## Writing a contract's docs.md

`counter-contract/docs.md` is the canonical template. Its 10-section skeleton
(documented in an HTML comment at the top of that file) is what every contract
guide should follow: what it does, run it, the source line by line, public vs.
private state, what the compiler generates, witnesses, the simulator, the tests,
try-it-yourself, credits. Tone is beginner-first; lead dense contracts with a
concrete analogy. Be honest about what a contract does not do.

## Honesty

Ground statements in the actual code and official docs. Credit the official
`midnightntwrk/example-counter` for the simulator pattern (its copyright notice
is preserved in each `vitest.config.ts`). Do not write contract code (especially
token code) from memory; pull from an authoritative current source.

## Resources

| Resource | URL |
|----------|-----|
| Midnight docs | https://docs.midnight.network |
| Compact language reference | https://docs.midnight.network/develop/reference/compact/lang-ref |
| example-counter (simulator pattern origin) | https://github.com/midnightntwrk/example-counter |
| OpenZeppelin Compact contracts | https://github.com/OpenZeppelin/compact-contracts |
