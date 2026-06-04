# Midnight Contracts

This project is built on the Midnight Network.

A lightweight, contract-focused catalog of [Compact](https://docs.midnight.network)
smart contracts for [Midnight](https://midnight.network), Cardano's
privacy-preserving sidechain. Each contract is a standalone workspace with its
source, witnesses, a phase-1 in-memory simulator, and a Vitest suite, plus a
beginner-friendly `docs.md` walkthrough.

This repo is deliberately **not** a full dApp. There is no UI and no CLI. The
focus is the contracts and their tests, so you can clone, read, run `npm test`,
and start modifying without standing up any infrastructure. For an end-to-end
example (contract + React + wallet), see the separate starter template.

## Prerequisites

- **Node.js** (v23+) & **npm** (v11+)
- **Compact** developer tools (the `compact` compiler; this repo pins toolchain `+0.31.0`)

You do **not** need Docker, a node, a wallet, or a proof server to run the test
suites. Phase-1 tests execute entirely in memory.

## Installation

```bash
# install all workspaces
npm install

# build all contracts
npm run build
```

## Available Contracts

| Contract | Folder | What it teaches | Guide |
|----------|--------|-----------------|-------|
| **Counter** | [`counter-contract/`](counter-contract) | The minimal contract: public ledger state and a single transition circuit. No privacy. | [docs.md](counter-contract/docs.md) |
| **Bulletin Board** | [`bulletin-board-contract/`](bulletin-board-contract) | Witnesses and selective disclosure: mixing private state into a public contract. | [docs.md](bulletin-board-contract/docs.md) |
| **Unshielded Token** | [`unshielded-token-contract/`](unshielded-token-contract) | Public tokens: mint, send, and receive an unshielded token plus native NIGHT. Ported verbatim from the official docs example. | [docs.md](unshielded-token-contract/docs.md) |
| **Shielded Token** | [`shielded-token-contract/`](shielded-token-contract) | Privacy-preserving Zswap coins: mint, send, and receive shielded tokens (hidden value/owner). Ported verbatim from the official docs example. | [docs.md](shielded-token-contract/docs.md) |

Each workspace follows the same five-part pattern:

```
src/<name>.compact          → the contract source
  ↓ compact compile
src/managed/<name>/         → generated TypeScript API, ZK keys, circuit IR
src/witnesses.ts            → private-state type + witness functions
src/test/simulators/        → in-memory CircuitContext harness (phase-1)
src/test/<name>.test.ts     → Vitest suite
```

Start with the **Counter** and its [walkthrough](counter-contract/docs.md). It
is the smallest contract and the `docs.md` template every other guide follows.

## Running a single contract

```bash
cd counter-contract
npm run compact      # compile the .compact source
npm test             # run the Vitest suite
```
