# Bulletin Board

A public corkboard that holds exactly one note at a time. Anyone can pin a note
when the board is empty, and the note's text is public for all to read. But the
author stays anonymous, and only that same author can later take their note
down. Nobody else can post while a note is up, and nobody else can remove it.

If the [counter](../counter-contract/docs.md) was the contract with *no*
privacy, this is the one that introduces it. It is the smallest contract that
genuinely needs a secret, and it shows the three moves that almost every
private contract on Midnight makes: take in a **witness**, prove something about
it without revealing it (a **commitment**), and explicitly **disclose** only the
values that are allowed to become public.

> **Analogy.** Think of a town-square corkboard with a single pin. When you post
> a note you also stamp it with invisible ink that only your own signet ring can
> produce. Everyone can read the note and see that *a* stamp is there, but no
> one can tell whose ring made it. Later, only the person whose ring reproduces
> the exact same stamp is allowed to pull the note down. The stamp is the
> *commitment*; the ring is your *secret key*; the contract never sees the ring,
> only the stamp.

---

## 1. What this contract does

The board has three pieces of public state: the note's `note` text, a `hasNote`
flag, and an `authorCommitment` (the invisible-ink stamp). Two actions move it:

```
        postNote("hello")                 takeDown()  (author only)
empty  ────────────────────►  has note  ────────────────────────►  empty
  ▲                                                                   │
  └───────────────────────────────────────────────────────────────┘
        a different user may now post
```

- **`postNote(content)`** succeeds only if the board is empty. It records the
  text publicly and stores a commitment to whoever posted it.
- **`takeDown()`** succeeds only if the caller can prove they are the original
  author, by reproducing the stored commitment from their own secret key.

The interesting part is what is *not* on the board: the author's identity. The
contract knows "the same person who posted can take down" without ever knowing
who that person is.

---

## 2. Run it in 60 seconds

```bash
# from the repo root
npm install

# from this workspace
cd bulletin-board-contract
npm run compact      # compile bulletin-board.compact into src/managed/bulletin-board/
npm test             # run the Vitest suite against the simulator
```

No node, wallet, or proof server is needed. The suite runs in memory (see
[§7](#7-the-simulator)).

> **Tip:** `npm run compact-fast` skips zero-knowledge key generation
> (`--skip-zk`) for quicker iteration while you change logic. Use the full
> `npm run compact` when you care about the real proving keys.

---

## 3. The contract, line by line

`src/bulletin-board.compact`:

```compact
pragma language_version >= 0.19;

import CompactStandardLibrary;

// Public ledger state - visible to everyone
export ledger note: Opaque<"string">;        // The note content (public when posted)
export ledger hasNote: Boolean;               // Whether the board currently has a note
export ledger authorCommitment: Bytes<32>;    // Commitment to the author's identity

// Witness declarations - private data provided by the user
witness local_secret_key(): Bytes<32>;

// Helper: turn a secret key into an identity commitment
pure circuit compute_author_commitment(sk: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "bboard:author:"), sk]);
}

export circuit postNote(content: Opaque<"string">): [] {
  assert(disclose(!hasNote), "Board is full - someone already posted a note");
  const sk = local_secret_key();
  const commitment = compute_author_commitment(sk);
  note = disclose(content);
  authorCommitment = disclose(commitment);
  hasNote = true;
}

export circuit takeDown(): [] {
  assert(disclose(hasNote), "No note to take down");
  const sk = local_secret_key();
  const callerCommitment = compute_author_commitment(sk);
  assert(disclose(callerCommitment == authorCommitment),
         "Only the original author can take down the note");
  hasNote = false;
}
```

Walking the new pieces (everything the counter already taught is assumed):

**`export ledger note: Opaque<"string">;`**
`Opaque<"string">` is a string the *contract* treats as a black box. The
contract never inspects its contents; it just stores and returns it. On the
TypeScript side it surfaces as a plain `string` (see [§5](#5-what-the-compiler-generates)).

**`witness local_secret_key(): Bytes<32>;`**
This is the headline difference from the counter. A `witness` is a function the
caller supplies, run *locally* in the caller's wallet, that feeds private data
into a circuit. Note it is a *declaration only*: there is no body here. The body
lives in TypeScript (see [§6](#6-witnesses--private-state)). The contract can
*use* the secret key inside a circuit, but the key itself never leaves the
caller's machine and never lands on-chain.

**`pure circuit compute_author_commitment(sk): Bytes<32>`**
A `pure circuit` is a helper with no access to ledger state; it just computes.
This one hashes the secret key together with a domain-separation tag
(`pad(32, "bboard:author:")`) using `persistentHash`. The result is a
**commitment**: a value derived from the secret that (a) reveals nothing about
the secret and (b) can only be reproduced by someone holding that same secret.
`pad(32, ...)` widens the tag string to a 32-byte value so it fits the
`Vector<2, Bytes<32>>` the hash expects.

**`disclose(...)` and what actually requires it.**
This is the concept to slow down on. `disclose` is a *promise to the compiler*:
"I know this value comes from private data, and I am publishing it on purpose."
The precise rule, which is worth verifying yourself (see
[Try it yourself](#9-try-it-yourself)), is narrower than it first looks: the
compiler requires `disclose` when **a private value is written into the ledger**.
Its own error phrases it as *"a ledger operation might disclose the witness
value."* In this contract exactly two writes trigger that rule:

- `note = disclose(content)` and
- `authorCommitment = disclose(commitment)`.

A subtle point: `content` is a *circuit parameter*, yet the compiler treats it
as private. That is the default in Compact. Everything flowing into a circuit
(parameters and witnesses alike) is private; the ledger is the only public
surface, so writing any input to it is a disclosure.

The other three `disclose` calls in this source, the ones wrapping the `assert`
conditions (`disclose(!hasNote)`, `disclose(hasNote)`,
`disclose(callerCommitment == authorCommitment)`), are **not required**. The
contract compiles without them. Asserting on a value, even a witness-derived
one, is not a ledger write, so it does not trip the rule. They are written
defensively and uniformly here, which is a fine habit but a useful thing to
recognize as optional rather than mandatory. [§4](#4-public-vs-private-state)
unpacks why.

**`assert(condition, message)`**
An assertion inside a circuit is a *constraint*: if it fails, no valid proof can
be produced, so the transaction simply cannot exist. The board-full check and
the author check are both enforced this way. There is no "transaction that ran
and failed"; an invalid call is unprovable.

---

## 4. Public vs. private state

This is the contract to learn the boundary on. Here is everything, sorted:

| | **Ledger (public)** | **Witness / private** |
|---|---|---|
| `note` (the text) | ✅ stored in the clear | |
| `hasNote` (the flag) | ✅ | |
| `authorCommitment` (the stamp) | ✅ stored | |
| the author's secret key | | ✅ never leaves the wallet |
| *who* the author is | | ✅ never derivable from the commitment |

The privacy trick is the `authorCommitment`. The contract needs to answer one
question at takedown time: "is the caller the same person who posted?" The naive
way would be to store the author's public key, but that would deanonymize them.
Instead it stores `hash(tag, secretKey)`. At takedown the caller recomputes that
same hash from their secret key and the contract checks the two match. Same
secret produces the same commitment, a different secret produces a different
one, and the hash cannot be run backwards to recover the key. Identity is
*proven* without being *revealed*.

It is worth being precise about when the compiler *forces* a `disclose`, because
the source can mislead you. As [§3](#3-the-contract-line-by-line) noted and the
exercises let you confirm, the compiler only requires it on the two lines that
**write a private value into the ledger** (`note = disclose(content)` and
`authorCommitment = disclose(commitment)`). The `disclose` wrappers around the
`assert` conditions are not required; the contract compiles fine without them.

So the mental model is not "mark every private value." It is narrower and more
useful: **a private value becomes public the moment it is written to the
ledger, and that write is the thing you must consciously declare.** Reads and
asserts can compute on private data freely; the ledger boundary is where the
leak is, and `disclose` is how you sign off on crossing it. When you read the
token contracts later, scanning for `disclose` on ledger writes is how you will
trace exactly what each circuit chooses to reveal.

Contrast all of this with the counter, whose `witnesses = {}` meant nothing
private ever moved. Here, private data flows in (`local_secret_key`), gets
transformed (`compute_author_commitment`), and a carefully chosen, non-revealing
projection of it (`commitment`) is disclosed to the ledger.

---

## 5. What the compiler generates

`npm run compact` runs `compact compile +0.31.0 ...` and produces
`src/managed/bulletin-board/` (generated; do not edit). The TypeScript API in
`contract/index.d.ts`:

```ts
export type Ledger = {
  readonly note: string;             // Opaque<"string">  -> string
  readonly hasNote: boolean;         // Boolean            -> boolean
  readonly authorCommitment: Uint8Array;  // Bytes<32>     -> Uint8Array
}

export type Witnesses<PS> = {
  local_secret_key(context: WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  postNote(context: CircuitContext<PS>, content_0: string): CircuitResults<PS, []>;
  takeDown(context: CircuitContext<PS>): CircuitResults<PS, []>;
}
```

Things to notice:

- The Compact types map to ordinary JS types: `Opaque<"string">` becomes
  `string`, `Boolean` becomes `boolean`, and `Bytes<32>` becomes a `Uint8Array`.
  That is why the tests compare commitments with `.toEqual(...)` on byte arrays.
- The `Witnesses` type is generated *from the contract*, and it dictates the
  shape your `witnesses.ts` must satisfy: `local_secret_key` must accept a
  `WitnessContext` and return a `[newPrivateState, Uint8Array]` tuple. The
  contract declares the witness; this type is the contract's demand that you
  implement it.
- `postNote` carries a `content_0: string` parameter; `takeDown` takes none.

---

## 6. Witnesses & private state

`src/witnesses.ts` is where the `local_secret_key` witness gets its body:

```ts
export type BulletinBoardPrivateState = {
  secretKey: Uint8Array;
};

export const createPrivateState = (secretKey: Uint8Array): BulletinBoardPrivateState => {
  return { secretKey };
};

export const witnesses = {
  local_secret_key: (
    context: WitnessContext<BulletinBoardPrivateState>
  ): [BulletinBoardPrivateState, Uint8Array] => {
    // Return the private state unchanged, and hand the circuit the secret key
    return [context.privateState, context.privateState.secretKey];
  },
};
```

- **`BulletinBoardPrivateState`** holds the one secret this contract needs: a
  32-byte `secretKey`. Unlike the counter's inert `privateCounter`, this private
  state is actually read by a circuit.
- **`witnesses.local_secret_key`** is the implementation the contract's
  declaration promised. The convention is that every witness returns a
  `[nextPrivateState, result]` tuple: the (possibly updated) private state, then
  the value the circuit asked for. This witness changes nothing, so it returns
  the state untouched alongside `secretKey`.
- This object is no longer empty. It is passed to `new Contract(witnesses)` in
  the simulator, which is how the contract's `local_secret_key()` call finds
  this code at runtime.

---

## 7. The simulator

`src/test/simulators/simulator.ts` defines `BulletinBoardSimulator`. It is the
same in-memory harness pattern as the counter (adapted from the official
[`midnightntwrk/example-counter`](https://github.com/midnightntwrk/example-counter),
credited in `vitest.config.ts`), with `postNote` and `takeDown` methods in place
of `increment`.

```ts
const sim = BulletinBoardSimulator.deployContract(secretKey1);  // user1's key
sim.createPrivateState("user2", secretKey2);                     // register a 2nd user

sim.as("user1").postNote("hello");        // returns the new Ledger
sim.as("user1").getLedger().hasNote;      // true
sim.as("user2").takeDown();               // throws: not the author
sim.as("user1").takeDown();               // ok
```

The mechanics are identical to the counter's harness (`deployContract` builds
the starting `CircuitContext`; each circuit call folds the returned context back
in). But one method that was vestigial there is load-bearing here:

- **`.as(name)`** swaps in *that user's private state* before the call. Because
  each user was registered with a different `secretKey`, `as("user1")` and
  `as("user2")` make `local_secret_key()` return different bytes, which produce
  different commitments. This is the whole point: the simulator lets you act as
  distinct anonymous identities and watch the contract tell them apart by
  commitment alone. The counter had no per-user state, so its `.as()` did
  nothing visible. Here it is how the privacy tests are even possible.

---

## 8. The tests

`src/test/bulletin-board.test.ts` has eight tests. Two secret keys are generated
with `randomBytes(32)`, and `createSimulator()` deploys as `user1` and registers
`user2`. The cases fall into three groups:

**Basic flow**
- empty board initially (`hasNote === false`),
- a user can post (`hasNote === true`, `note` matches the text),
- after takedown the board is empty and a *different* user can then post.

**Authorization (enforced by `assert` in the circuit)**
```ts
it("should prevent another user from posting when board is full", () => {
  simulator.as("user1").postNote("First note!");
  expect(() => simulator.as("user2").postNote("Second note!"))
    .toThrow("Board is full - someone already posted a note");
});

it("should prevent non-author from taking down the note", () => {
  simulator.as("user1").postNote("My private note");
  expect(() => simulator.as("user2").takeDown())
    .toThrow("Only the original author can take down the note");
});
```
These pass because the failed `assert` makes the call unprovable; the simulator
surfaces that as a thrown error.

**Privacy (the commitment scheme working)**
```ts
it("should preserve author privacy across multiple post/takedown cycles", () => {
  let ledger = simulator.as("user1").postNote("Note 1");
  const commitment1 = ledger.authorCommitment;
  simulator.as("user1").takeDown();

  ledger = simulator.as("user1").postNote("Note 2");
  const commitment2 = ledger.authorCommitment;
  expect(commitment1).toEqual(commitment2);     // same author -> same commitment

  simulator.as("user1").takeDown();
  ledger = simulator.as("user2").postNote("Note 3");
  expect(commitment1).not.toEqual(ledger.authorCommitment);  // different author -> different
});
```
Read this one slowly. It demonstrates the two properties a commitment must have
at once: it is *stable* for a given author (so authorship can be checked) and
*distinct* across authors (so they are not confused), while the identity behind
it is never stored. That is anonymous-but-accountable in four assertions.

The tests also log gas cost and the raw `authorCommitment` bytes into
`logs/logic-testing/`. Open one after a run to see the actual commitment bytes
change between users.

---

## 9. Try it yourself

Recompile (`npm run compact-fast`) and re-test after each change.

1. **Watch the leak.** In `postNote`, temporarily remove the `disclose(...)`
   around `content` (write `note = content;`) and recompile. The compiler
   rejects it with *"potential witness-value disclosure must be declared but is
   not... a ledger operation might disclose the witness value."* That is the
   rule from [§3](#3-the-contract-line-by-line) firing on a ledger write. This
   is the single best way to feel what `disclose` is for.
2. **Find the load-bearing discloses.** Now go the other way: remove the
   `disclose(...)` wrappers from the three `assert` conditions
   (`!hasNote`, `hasNote`, `callerCommitment == authorCommitment`) and
   recompile. It should still compile. Which `disclose` calls were actually
   required, and what does that tell you about *where* the privacy boundary
   really is? (Put them back afterward; uniform `disclose` is a reasonable
   style even where it is optional.)
3. **Domain separation.** Change the tag `"bboard:author:"` in the one shared
   `compute_author_commitment` helper to a different string and re-run the
   tests. Do any fail? They should not, because both circuits hash the same
   way. So what is the tag protecting against, if not these tests? (Hint: think
   about a commitment from *this* contract being replayed against a *different*
   contract.)
4. **Add an edit action.** Sketch a new `editNote(content)` circuit that lets
   *only the current author* replace the text without taking the note down.
   Which existing circuit is your template, and which `assert` do you reuse?
5. **Think about what is still public.** The note text is stored in the clear.
   If you wanted the *text* private too (only provable, not readable), what
   would have to change? (You are now describing a very different contract;
   naming the change is enough.)

---

## 10. Credits & references

- The simulator and phase-1 testing pattern is **adapted from the official
  [`midnightntwrk/example-counter`](https://github.com/midnightntwrk/example-counter)**;
  its copyright notice is preserved in this workspace's `vitest.config.ts`.
- `persistentHash`, `pad`, `Opaque`, `Bytes`, and `Vector` come from
  `CompactStandardLibrary`.
- Selective disclosure and witness concepts:
  <https://docs.midnight.network/develop/reference/compact/lang-ref>
- Runtime types (`CircuitContext`, `WitnessContext`, `ledger`, and friends) come
  from `@midnight-ntwrk/compact-runtime`.
