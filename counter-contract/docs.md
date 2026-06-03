<!--
═══════════════════════════════════════════════════════════════════════════
  docs.md TEMPLATE  ·  reusable skeleton for every contract in this repo
═══════════════════════════════════════════════════════════════════════════
  The counter below is the canonical instance. To document a new contract,
  copy these section headings and fill them in for that contract. Keep the
  order; it walks a reader from "what is this" down to "now change it":

    1. What this contract does        (the story, in plain language)
    2. Run it in 60 seconds           (clone, install, compile, test)
    3. The contract, line by line     (the .compact source, annotated)
    4. Public vs. private state       (the ledger / witness privacy lens)
    5. What the compiler generates     (managed/, the Ledger type, circuits)
    6. Witnesses & private state       (witnesses.ts)
    7. The simulator                   (the phase-1 test harness)
    8. The tests                       (how behavior is pinned down)
    9. Try it yourself                 (small exercises that build intuition)
   10. Credits & references

  Tone: beginner-first. Lead dense contracts with a concrete analogy.
  Be honest about what a contract does NOT do; gaps teach as well as features.
═══════════════════════════════════════════════════════════════════════════
-->

# Counter

A public tally that only ever counts up. Anyone can submit a transaction that
adds one to a shared on-chain number. There are no owners, no secrets, and no
limits. It is the smallest contract that still has real moving parts, which
makes it the perfect first stop.

If the rest of this repo is a catalog of privacy-preserving contracts, the
counter is the one with no privacy at all, and that turns out to be a useful
thing to see first. You can only appreciate what the private parts buy you once
you have watched a fully public contract work.

---

## 1. What this contract does

There is a single number living on-chain called `round`. It starts at `0`.
The contract exposes exactly one action, `increment`, and calling it adds `1`
to `round`. That is the whole thing.

```
round: 0  --increment-->  1  --increment-->  2  --increment-->  3 ...
```

Every step is a real Midnight transaction: a caller builds it, a zero-knowledge
proof is produced, and the network applies the state change. But because
`round` is public ledger state, anyone can read its value at any time. No proof
is needed to look, only to change it.

---

## 2. Run it in 60 seconds

```bash
# from the repo root
npm install

# from this workspace
cd counter-contract
npm run compact      # compile counter.compact into src/managed/counter/
npm test             # run the Vitest suite against the simulator
```

You do not need a running node, a wallet, or a proof server to do this.
The tests run entirely in memory (see [§7](#7-the-simulator)). That is the
point of "phase-1" testing: fast feedback on contract *logic* before you ever
touch infrastructure.

> **Tip:** `npm run compact-fast` skips zero-knowledge key generation
> (`--skip-zk`). It compiles much faster and is fine while you are iterating on
> logic. Use the full `npm run compact` when you care about the real proving
> keys.

---

## 3. The contract, line by line

Here is the entire contract, `src/counter.compact`:

```compact
pragma language_version >= 0.23;

import CompactStandardLibrary;

// public state
export ledger round: Counter;

// transition function changing public state
export circuit increment(): [] {
  round.increment(1);
}
```

Four lines of substance. Let's take them in order.

**`pragma language_version >= 0.23;`**
Declares which version of the Compact *language* this source expects. It is a
contract with the compiler, not with the network. Note that the *compiler
toolchain* version is separate: this workspace pins it in `package.json` as
`compact compile +0.31.0 ...`. Language version is not the same as toolchain
version, and both matter.

**`import CompactStandardLibrary;`**
Pulls in Compact's standard library, which is where the `Counter` type comes
from. You do not have to define a counter from scratch. The stdlib ships a safe
one with an `increment` operation already on it.

**`export ledger round: Counter;`**
This is the single most important line. `ledger` means *public, on-chain
state*. `round` is its name and `Counter` is its type. `export` makes it
readable from the generated TypeScript. Because it is ledger state, its value
is visible to everyone on the network. There is nothing private here.

**`export circuit increment(): [] { round.increment(1); }`**
A `circuit` is a state-transition function, the only way to change ledger
state. The return type `[]` is the empty tuple, Compact's "returns nothing"
(there is no `void` keyword; you return `[]`). The body calls
`round.increment(1)`, the stdlib operation that adds `1` to the counter.
`export` makes the circuit callable from outside the contract.

> **Why is it called a *circuit* and not a *function*?**
> Because every state transition on Midnight is compiled into a
> zero-knowledge circuit. When someone calls `increment`, they don't just
> "run" it. They produce a cryptographic *proof* that they ran it correctly,
> and the network verifies that proof. The counter's proof is trivial (it has
> nothing private to hide), but the machinery is identical to the contracts
> that do.

---

## 4. Public vs. private state

Midnight contracts have two kinds of state, and telling them apart is the
single most important skill in Compact:

| | **Ledger (public)** | **Witness / private state** |
|---|---|---|
| Lives | on-chain, replicated | off-chain, in the caller's wallet |
| Visible to | everyone | only the caller |
| Declared with | `export ledger ...` | `witness ...()` |
| In the counter | `round: Counter` | *(none used; see below)* |

**The counter uses only public state.** It declares no witnesses. That makes
it the clean baseline: when you later read the bulletin-board or token
contracts, the *new* thing you will see is private state being mixed in.

There is an instructive wrinkle, though. The TypeScript side defines a
`CounterPrivateState` with a `privateCounter` field (see
[§6](#6-witnesses--private-state)), and the test harness carries it around. But
the contract never reads it: `witnesses = {}`. So when you run the tests you
will see the public `round` climb to `1` while the private `privateCounter`
stays at `0`, untouched. That is not a bug; it is the lesson. Private state
only changes when a contract actually wires a witness into a circuit. The
counter never does, so its private state is inert.

---

## 5. What the compiler generates

Running `npm run compact` invokes:

```
compact compile +0.31.0 src/counter.compact src/managed/counter
```

and produces `src/managed/counter/`, generated code you don't edit by hand:

```
managed/counter/
├── contract/index.{js,d.ts}   ← the TypeScript API you import in tests
├── keys/increment.{prover,verifier}   ← zero-knowledge proving/verifying keys
├── zkir/increment.{zkir,bzkir}         ← the compiled circuit (ZK intermediate repr)
└── compiler/contract-info.json
```

The piece you will actually touch is `contract/index.d.ts`. For the counter it
exposes, among other things:

```ts
export type Ledger = {
  readonly round: bigint;          // note: a JS bigint, not number
}

export type ImpureCircuits<PS> = {
  increment(context: CircuitContext<PS>): CircuitResults<PS, []>;
}

export declare class Contract<PS, W extends Witnesses<PS>> {
  constructor(witnesses: W);
  initialState(context: ConstructorContext<PS>): ConstructorResult<PS>;
  impureCircuits: ImpureCircuits<PS>;
  // ...
}

export declare function ledger(state): Ledger;   // decode raw state into typed Ledger
```

Two things worth internalizing:

- **`round` is a `bigint`.** On-chain integers map to JavaScript `bigint`, not
  `number`. That is why the tests assert `toEqual(0n)` and `toEqual(1n)`, with
  the `n`. Mixing up `0` and `0n` is a classic first-day mistake.
- **`increment` is an *impure* circuit.** "Impure" means it changes state.
  It takes a `CircuitContext` (the world it runs in) and returns
  `CircuitResults` (the new world plus proof data). The simulator's whole job
  is to manage that context for you.

---

## 6. Witnesses & private state

`src/witnesses.ts`, the entire file:

```ts
export type CounterPrivateState = {
  privateCounter: number;
};

export const createPrivateState = (value: number): CounterPrivateState => {
  return { privateCounter: value };
};

export const witnesses = {};
```

- **`CounterPrivateState`** is the shape of the caller's private data. The
  counter doesn't really need any, but the harness expects *some* private-state
  type, so we give it a minimal one with a single `privateCounter` field.
- **`createPrivateState(value)`** is a small factory the simulator uses to
  seed each user's private state.
- **`witnesses = {}`** is the headline. A witness is a function the contract
  calls to pull in private data mid-circuit. The counter defines none, so this
  object is empty. When you reach a contract that *does* use private data, this
  is where its witness functions will live, and they will be wired into the
  contract via `new Contract(witnesses)`.

---

## 7. The simulator

`src/test/simulators/simulator.ts` defines `CounterSimulator`, an in-memory
harness that lets you execute circuits without any infrastructure. This pattern
is **adapted from the official `midnightntwrk/example-counter`** repo (credited
in `vitest.config.ts`); we reuse a consistent version of it across every
contract in this repo.

What it gives you:

```ts
const sim = CounterSimulator.deployContract(0);  // "deploy" with seed private state
sim.as("p1").getLedger().round;                  // read public state, returns 0n
sim.as("p1").increment();                          // run the circuit
sim.as("p1").getLedger().round;                  // returns 1n
```

How it works, conceptually:

- **`deployContract(secretKey)`** builds a fresh `Contract`, samples a contract
  address, and calls `initialState(...)` to produce the starting
  `CircuitContext`. That context is the bundle of *(private state, public/query
  state, Zswap local state, cost model)* that every circuit reads and rewrites.
- **`.as(name)`** selects *which user* is acting. The harness can hold several
  users' private states at once (`createPrivateState("p2", ...)`), and `.as`
  swaps the active one into the context before a call. The counter doesn't have
  per-user state, so this is mostly scaffolding here, but it is the same API
  the multi-party contracts rely on, so it is worth recognizing early.
- **`increment(sender?)`** is the interesting method. It calls
  `contract.impureCircuits.increment(...)` with the current context, logs the
  gas cost and proof data, then folds the returned context back in with
  `updateStateAndGetLedger` and hands you the new `Ledger`. That fold, meaning
  *replace the context with the circuit's output context*, is exactly what a
  real node does when it applies a transaction. The simulator just does it in
  memory.

The key idea: a `CircuitContext` is the whole world a circuit sees, and running
a circuit returns a new world. No node, no proof server, no wallet, just data
structures from `@midnight-ntwrk/compact-runtime`. That is why the test suite
runs in milliseconds.

---

## 8. The tests

`src/test/counter.test.ts` pins down two behaviors. Stripped of the logging:

```ts
it("Display initial values", () => {
  const sim = createSimulator();
  expect(sim.as("p1").getLedger().round).toEqual(0n);          // public starts at 0
  expect(sim.as("p1").getPrivateState()).toEqual({ privateCounter: 0 });
});

it("increments the counter correctly", () => {
  const sim = createSimulator();
  const next = sim.as("p1").increment();
  expect(next.round).toEqual(1n);                                // public went up
  expect(sim.as("p1").getPrivateState()).toEqual({ privateCounter: 0 }); // private untouched
});
```

Read the second test closely; it is the whole privacy model in four lines.
After one `increment`:

- public `round` is `1n`, the state change everyone can see, and
- private `privateCounter` is still `0`, because, as we saw in
  [§4](#4-public-vs-private-state), no witness ever touched it.

`createSimulator()` (top of the test file) deploys with `key1 = 0` and
registers a second user `p2` with `key2 = 1`, using `toHexPadded` to turn a
label like `"player1"` into a 32-byte hex public key. The `player1` and
`player2` callers are exported and reused by the simulator's constructor.

The tests also dump rich diagnostics through a `logger` (gas cost, query
context, Zswap local state) into `logs/logic-testing/`. Those logs aren't
assertions. They are there so you can *watch* what a circuit run actually
produces. Open one after a test run; it is a great way to build intuition.

---

## 9. Try it yourself

Small changes, each teaching one thing. Recompile (`npm run compact-fast`) and
re-test after each.

1. **Predict, then verify.** Add a third test that increments three times and
   asserts `round` is `3n`. Did you remember the `n`?
2. **Add a step.** Change the circuit to `round.increment(2)`. Which test
   breaks, and what does the failure message tell you about how much detail the
   assertion captures?
3. **Read before/after.** In a test, call `getLedger().round` before and after
   `increment()` and log both. Convince yourself the simulator really is
   threading a new context through.
4. **Reach for the wrinkle.** Knowing the counter uses no witness, sketch (in a
   comment) what you would have to add to make `privateCounter` actually change
   when `increment` runs. What goes in `witnesses`, and how would the circuit
   call it? (You will build exactly this in the bulletin-board contract.)

---

## 10. Credits & references

- The `CounterSimulator` and phase-1 testing pattern is **adapted from the
  official [`midnightntwrk/example-counter`](https://github.com/midnightntwrk/example-counter)**.
  Its copyright notice is preserved in this workspace's `vitest.config.ts`.
- The `Counter` type and `increment` operation come from `CompactStandardLibrary`.
- Official Compact language reference:
  <https://docs.midnight.network/develop/reference/compact/lang-ref>
- Runtime types (`CircuitContext`, `QueryContext`, `ledger`, and friends) come
  from `@midnight-ntwrk/compact-runtime`.
