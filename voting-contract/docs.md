# Voting

A single yes / no / abstain ballot with an owner, a deadline, and one vote per
person. The owner sets the question, opens voting, and closes it once the
deadline has passed. Anyone holding a secret key can vote exactly once, and the
running tallies are public for all to read, but *who* voted stays hidden.

If the [counter](../counter-contract/docs.md) had no privacy and the
[bulletin board](../bulletin-board-contract/docs.md) introduced a single secret,
this contract puts that secret to work. It reuses the bulletin board's
commitment trick for ownership, then adds the move that defines on-chain voting:
a **nullifier**, a one-time stamp that lets the contract enforce "one vote per
voter" without ever learning who the voters are. Along the way it introduces a
small **state machine** (`enum` phases), a `Set` and `Counter`s in the ledger, a
parameterized `constructor`, and **block time**.

> **Analogy.** Picture a sealed ballot box with one question painted on the lid
> and a closing time stamped beside it. To vote you drop in a token, and as you
> do, a turnstile clicks your personal ring once and refuses it ever after, so
> you cannot vote twice. The clerk who set up the box (the *owner*) is the only
> one who can declare voting open or, once the clock has passed the closing time,
> sealed. The running counts on the front are visible to everyone; the turnstile
> remembers *that* a ring passed, never *whose*. The ring is your secret key, the
> click it leaves is the **nullifier**, and the painted question is the proposal.

---

## 1. What this contract does

There is one proposal, fixed at deploy time (`title` + `description`), and three
public tallies (`yesVotes`, `noVotes`, `abstainVotes`). The ballot moves through
three phases, and only the owner drives the transitions:

```
                owner               owner (after deadline)
   SETUP  ───── openVoting ──────►  OPEN  ───── closeVoting ──────►  CLOSED
                                     │
                                     │  castVote(YES | NO | ABSTAIN)
                                     ▼  (anyone, once, before the deadline)
                              tallies go up
```

- **`openVoting()`** — owner only; moves `SETUP → OPEN`.
- **`castVote(choice)`** — anyone, but only while `OPEN` and before the deadline,
  and only once per secret key. Increments the chosen tally.
- **`closeVoting()`** — owner only; moves `OPEN → CLOSED`, but only after the
  deadline (`voteEndingTime`) has passed. The tallies are then frozen.

The interesting part, as always, is what is *not* recorded: the link between a
voter and their vote. The contract can prove "this voter has not voted yet" and
then "now they have" without ever storing their identity.

---

## 2. Run it in 60 seconds

```bash
# from the repo root
npm install

# from this workspace
cd voting-contract
npm run compact      # compile voting.compact into src/managed/voting/
npm test             # run the Vitest suite against the simulator
```

No node, wallet, or proof server is needed. The suite runs in memory (see
[§7](#7-the-simulator)).

> **Tip:** `npm run compact-fast` skips zero-knowledge key generation
> (`--skip-zk`) for quicker iteration while you change logic. Use the full
> `npm run compact` when you care about the real proving keys.

---

## 3. The contract, line by line

`src/voting.compact`:

```compact
pragma language_version >= 0.23;

import CompactStandardLibrary;

export enum ProposalState { SETUP, OPEN, CLOSED }
export enum VoteChoice { YES, NO, ABSTAIN }

export ledger phase: ProposalState;
export ledger title: Opaque<"string">;
export ledger description: Opaque<"string">;
export ledger yesVotes: Counter;
export ledger noVotes: Counter;
export ledger abstainVotes: Counter;
export ledger usedNullifiers: Set<Bytes<32>>;
export sealed ledger voteEndingTime: Uint<64>;
export sealed ledger ownerCommitment: Bytes<32>;

witness local_secret_key(): Bytes<32>;

circuit ownerCommitmentOf(_sk: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "vote:owner:"), _sk]);
}

circuit voteNullifier(_sk: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "vote:nullifier:"), _sk]);
}

constructor(customTitle: Opaque<"string">, customDescription: Opaque<"string">,
            customVoteEndingTime: Uint<64>) {
  ownerCommitment = disclose(ownerCommitmentOf(local_secret_key()));
  title = disclose(customTitle);
  description = disclose(customDescription);
  phase = ProposalState.SETUP;
  voteEndingTime = disclose(customVoteEndingTime);
}

export circuit openVoting(): [] {
  assert(ownerCommitment == ownerCommitmentOf(local_secret_key()), "Only the owner can open voting");
  assert(phase == ProposalState.SETUP, "Voting can only be opened from the setup phase");
  phase = ProposalState.OPEN;
}

export circuit closeVoting(): [] {
  assert(ownerCommitment == ownerCommitmentOf(local_secret_key()), "Only the owner can close voting");
  assert(phase == ProposalState.OPEN, "Voting can only be closed from the open phase");
  assert(blockTimeGt(voteEndingTime), "Voting cannot be closed before the ending time");
  phase = ProposalState.CLOSED;
}

export circuit castVote(choice: VoteChoice): [] {
  assert(phase == ProposalState.OPEN, "Voting is not open");
  assert(!blockTimeGt(voteEndingTime), "Voting period has ended");

  const _sk = local_secret_key();
  const nul = voteNullifier(_sk);
  assert(!usedNullifiers.member(disclose(nul)), "This voter has already voted");

  usedNullifiers.insert(disclose(nul));

  const selected = disclose(choice);
  if (selected == VoteChoice.YES) {
    yesVotes.increment(1);
  } else if (selected == VoteChoice.NO) {
    noVotes.increment(1);
  } else if (selected == VoteChoice.ABSTAIN) {
    abstainVotes.increment(1);
  }
}
```

Walking the new pieces (everything the counter and bulletin board taught is
assumed):

**`export enum ProposalState { SETUP, OPEN, CLOSED }` and `VoteChoice`**
Compact has `enum`s, and they make a clean *state machine*. `phase` is a ledger
field of an enum type, so the contract's lifecycle is a single public value that
each circuit checks and advances. `VoteChoice` is the closed set of votes a
caller may pass in. Enums map to small integers (`SETUP = 0`, `OPEN = 1`, …);
that detail surfaces again in [§5](#5-what-the-compiler-generates).

**`export ledger yesVotes: Counter;` (and `no`, `abstain`)**
Three independent `Counter`s, the same stdlib type the counter contract used.
Each `castVote` bumps exactly one of them. They are public, which is the whole
point of a tally.

**`export ledger usedNullifiers: Set<Bytes<32>>;`**
A ledger `Set`, new in this repo. It records the nullifier of every vote already
cast. Its only jobs are `member(x)` (has this nullifier been seen?) and
`insert(x)` (mark it seen). It never stores anything tied to an identity, just
opaque 32-byte stamps.

**`export sealed ledger voteEndingTime: Uint<64>;` (and `ownerCommitment`)**
`sealed` means *write-once*: the field can be set in the constructor and never
again. The deadline and the owner are fixed at deploy and cannot be changed
afterward, which the compiler enforces for you. (`Uint<64>` on-chain becomes a
JS `bigint`.)

**`circuit voteNullifier(_sk): Bytes<32>`**
The heart of the contract. It hashes the voter's secret key with a
domain-separation tag (`"vote:nullifier:"`) into a commitment, exactly like the
owner commitment but under a *different* tag. Because the same key always hashes
to the same nullifier, a voter who tries to vote twice produces a nullifier that
is already in the set, and the second vote is rejected. Because it is a hash, the
nullifier reveals nothing about the key. One key → one nullifier → one vote.

> **Why two tags, `"vote:owner:"` and `"vote:nullifier:"`?** Domain separation.
> They keep the owner commitment and the voting nullifier in different
> namespaces, so a value derived for one purpose can never be replayed as the
> other. The owner's commitment and the owner's nullifier (if they also voted)
> are unrelated values.

**`constructor(customTitle, customDescription, customVoteEndingTime)`**
The first contract here with constructor *parameters*. It runs once at deploy:
it stamps the deployer as the owner (`ownerCommitment = ...ownerCommitmentOf(
local_secret_key())`, reading the deployer's secret key via the witness), records
the question and deadline, and sets `phase = SETUP`. Whoever deploys is the
owner, forever.

**`blockTimeGt(voteEndingTime)`**
A standard-library predicate: true when the current block's time is greater than
the given value (seconds since the Unix epoch). It appears twice, with opposite
intent:

- `closeVoting` asserts `blockTimeGt(voteEndingTime)` — you may only close *after*
  the deadline.
- `castVote` asserts `!blockTimeGt(voteEndingTime)` — you may only vote *before*
  the deadline.

Note these are two separate gates. Voting stops at the deadline; closing is a
distinct, owner-only act that can happen any time after it.

---

## 4. Public vs. private state

This contract is a good one for seeing that privacy is *selective*: some things
are deliberately public, exactly one thing is deliberately hidden.

| | **Ledger (public)** | **Witness / private** |
|---|---|---|
| `phase`, `title`, `description` | ✅ | |
| `yesVotes` / `noVotes` / `abstainVotes` | ✅ the running tally is public | |
| `voteEndingTime`, `ownerCommitment` | ✅ (sealed) | |
| `usedNullifiers` (the stamps) | ✅ stored, but they are just hashes | |
| each caller's secret key | | ✅ never leaves the wallet |
| **the link voter → vote** | | ✅ never recorded |

What `disclose` is doing here, line by line:

- In the **constructor**, `customTitle`, `customDescription`, and
  `customVoteEndingTime` are parameters, which Compact treats as private by
  default, and `ownerCommitmentOf(local_secret_key())` is witness-derived.
  Writing any of them to the ledger is a disclosure, so each gets `disclose(...)`.
- In **`castVote`**, `disclose(nul)` appears on both the `member` check and the
  `insert`: the nullifier is derived from the secret key, and putting it on-chain
  (or even testing membership against the public set) crosses the privacy
  boundary. We *choose* to publish the nullifier, because that is what makes
  double-voting detectable. Crucially, publishing the nullifier is safe: it is a
  one-way hash, so it identifies the *vote* without identifying the *voter*.
- Also in `castVote`, `disclose(choice)`. The `choice` parameter is private, and
  branching on it to decide which public counter to bump would leak which branch
  ran. We disclose it on purpose, because the tallies are public anyway.

That last point is the honest limitation worth stating plainly:

> **This contract hides *who* voted, not *what* they voted.** The nullifier
> unlinks a voter from their vote, but the tallies are public and a single
> `castVote` transaction visibly increments one specific counter, so an observer
> of that transaction learns the choice it carried. Hiding the choice as well
> (so only the final totals are ever revealed) is a meaningfully harder design,
> using homomorphic or commitment-based tallies. See
> [Try it yourself](#9-try-it-yourself).

Compare the privacy ladder across the repo: the counter moved nothing private;
the bulletin board disclosed a commitment so one anonymous author could be
re-recognized; here a *fresh* commitment per voter (the nullifier) is disclosed
precisely so each anonymous voter can be recognized **once and only once**.

---

## 5. What the compiler generates

`npm run compact` runs `compact compile +0.31.0 ...` and produces
`src/managed/voting/` (generated; do not edit). The TypeScript API in
`contract/index.d.ts`:

```ts
export enum ProposalState { SETUP = 0, OPEN = 1, CLOSED = 2 }
export enum VoteChoice { YES = 0, NO = 1, ABSTAIN = 2 }

export type Ledger = {
  readonly phase: ProposalState;
  readonly title: string;            // Opaque<"string"> -> string
  readonly description: string;
  readonly yesVotes: bigint;         // Counter          -> bigint
  readonly noVotes: bigint;
  readonly abstainVotes: bigint;
  usedNullifiers: {                  // Set<Bytes<32>>
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>;
  };
  readonly voteEndingTime: bigint;   // Uint<64>  -> bigint
  readonly ownerCommitment: Uint8Array;  // Bytes<32> -> Uint8Array
};

export type ImpureCircuits<PS> = {
  openVoting(context: CircuitContext<PS>): CircuitResults<PS, []>;
  closeVoting(context: CircuitContext<PS>): CircuitResults<PS, []>;
  castVote(context: CircuitContext<PS>, choice_0: VoteChoice): CircuitResults<PS, []>;
};

export declare class Contract<PS, W extends Witnesses<PS>> {
  constructor(witnesses: W);
  initialState(context: ConstructorContext<PS>,
               customTitle_0: string,
               customDescription_0: string,
               customVoteEndingTime_0: bigint): ConstructorResult<PS>;
  impureCircuits: ImpureCircuits<PS>;
}
```

Things to notice:

- **The enums come across as TypeScript enums.** In tests you write
  `VoteChoice.YES` and compare `ledger.phase` against `ProposalState.OPEN`
  rather than against raw numbers.
- **The tallies are `bigint`.** Assertions use `0n`, `1n`, etc., the same
  `bigint` discipline the counter taught.
- **`usedNullifiers` is read-only-ish from TS.** The generated type exposes
  `member`, `size`, `isEmpty`, and iteration, so a test *can* inspect the set,
  but the only way to *change* it is by running `castVote`.
- **`initialState` now takes the three constructor arguments.** The simulator
  forwards `title`, `description`, and the deadline through it
  (see [§7](#7-the-simulator)).

---

## 6. Witnesses & private state

`src/witnesses.ts` is small; the contract has exactly one witness:

```ts
export type VotingPrivateState = {
  secretKey: Uint8Array;
};

export const createPrivateState = (secretKey: Uint8Array): VotingPrivateState => {
  return { secretKey };
};

export const witnesses = {
  local_secret_key: (
    context: WitnessContext<VotingPrivateState>
  ): [VotingPrivateState, Uint8Array] => {
    return [context.privateState, context.privateState.secretKey];
  },
};
```

- **`VotingPrivateState`** holds the single secret a participant needs: a 32-byte
  `secretKey`. The *same* key plays two roles depending on who holds it: for the
  deployer it derives the owner commitment; for a voter it derives the nullifier.
- **`witnesses.local_secret_key`** is the body behind the contract's `witness`
  declaration. It returns the `[nextPrivateState, result]` tuple every witness
  returns, here handing back the key and leaving private state unchanged.

This is identical in shape to the bulletin board's witness; the novelty is
entirely in how the *contract* uses the key (two different commitments), not in
how the key is supplied.

---

## 7. The simulator

`src/test/simulators/simulator.ts` defines `VotingSimulator`, the same in-memory
harness pattern as the other contracts (adapted from the official
[`midnightntwrk/example-counter`](https://github.com/midnightntwrk/example-counter),
credited in `vitest.config.ts`). Two things are specific to voting.

```ts
const sim = VotingSimulator.deployContract(ownerSk, "Adopt X?", "…", 1000n);
sim.createPrivateState("voter1", voter1Sk);   // register voters with their own keys

sim.as("owner").openVoting();                 // owner-only
sim.setBlockTime(999n);                        // before the deadline
sim.as("voter1").castVote(VoteChoice.YES);    // tallies.yesVotes -> 1n
sim.setBlockTime(1001n);                        // after the deadline
sim.as("owner").closeVoting();                // owner-only, now allowed
```

- **`deployContract(secretKey, title, description, voteEndingTime)`** forwards the
  three extra arguments into `initialState(...)`. The deploying key becomes the
  owner, registered internally under the name `"owner"`.
- **`setBlockTime(seconds)`** is the new lever. The `blockTimeGt(voteEndingTime)`
  guards read the simulated block time off the query context
  (`QueryContext.block.secondsSinceEpoch`), and this method sets it. Call it
  right before a time-sensitive circuit, since each circuit call produces a fresh
  context. This is how the suite tests "can't vote after the deadline" and
  "can't close before it" without any real clock.

As in the bulletin board, **`.as(name)`** swaps in a participant's secret key
before the call, so `as("owner")`, `as("voter1")`, and `as("voter2")` make
`local_secret_key()` return different bytes, hence different commitments and
nullifiers. That is what lets the tests act as distinct anonymous voters.

---

## 8. The tests

`src/test/voting.test.ts` has 12 tests. Three secret keys are generated with
`randomBytes(32)` (an owner and two voters), and `createSimulator()` deploys as
the owner with a fixed `TITLE`, `DESCRIPTION`, and `ENDING_TIME = 1000n`, then
registers the two voters. The cases fall into four groups.

**Lifecycle & access control** (enforced by `assert` in the circuits)
```ts
expect(sim.as("owner").getLedger().phase).toEqual(ProposalState.SETUP);
expect(() => sim.as("voter1").openVoting()).toThrow("Only the owner can open voting");
sim.as("owner").openVoting();                       // SETUP -> OPEN
expect(() => sim.as("owner").openVoting())
  .toThrow("Voting can only be opened from the setup phase");
```

**Tallying**
```ts
sim.as("owner").openVoting();
sim.setBlockTime(ENDING_TIME - 1n);
expect(sim.as("voter1").castVote(VoteChoice.YES).yesVotes).toEqual(1n);
expect(sim.as("voter2").castVote(VoteChoice.NO).noVotes).toEqual(1n);
```
Each `VoteChoice` lands in its own counter; abstain has its own test too.

**One vote per voter** (the nullifier doing its job)
```ts
sim.as("voter1").castVote(VoteChoice.YES);
expect(() => sim.as("voter1").castVote(VoteChoice.NO))
  .toThrow("This voter has already voted");
```
The second call rebuilds the *same* nullifier from `voter1`'s key, finds it in
`usedNullifiers`, and the `assert` makes the transaction unprovable. A different
voter, with a different key, sails through.

**The deadline** (the two `blockTimeGt` gates)
```ts
sim.as("owner").openVoting();
sim.setBlockTime(ENDING_TIME + 1n);
expect(() => sim.as("voter1").castVote(VoteChoice.YES))
  .toThrow("Voting period has ended");          // votes stop at the deadline

sim.setBlockTime(ENDING_TIME - 1n);
expect(() => sim.as("owner").closeVoting())
  .toThrow("Voting cannot be closed before the ending time");  // closing waits for it
```
The closing test then advances the clock past `ENDING_TIME`, closes as the owner,
asserts `phase === CLOSED` with the tally frozen, and confirms a further
`castVote` now throws `"Voting is not open"`.

The tests also log gas cost and circuit results into `logs/logic-testing/`. Open
one after a run to watch a vote flow through.

---

## 9. Try it yourself

Recompile (`npm run compact-fast`) and re-test after each change.

1. **Feel the nullifier.** Comment out the
   `assert(!usedNullifiers.member(disclose(nul)), ...)` line and re-run. Which
   test fails, and what does that tell you the line was buying? (Put it back.)
2. **Find the required discloses.** In `castVote`, try removing `disclose(...)`
   from around `choice` (write `if (choice == VoteChoice.YES)`), recompile, and
   read the error. Now do the same for the `member`/`insert` nullifier discloses.
   Which crossings does the compiler insist on, and why?
3. **Tighten or loosen the clock.** Change `castVote`'s guard from
   `!blockTimeGt(voteEndingTime)` to allow voting right up to and including the
   deadline second, or make `closeVoting` callable exactly *at* the deadline.
   What is the difference between `blockTimeGt` and a `>=` you would have to build?
4. **Add an eligibility list.** Right now anyone with any key can vote once.
   Sketch how you would restrict voting to a pre-registered set of voters. What
   new ledger state and which witness would you add? (This is the bridge toward a
   Merkle-tree allowlist.)
5. **Hide the choice, not just the voter.** Name what would have to change so that
   only the *final totals* are ever revealed and an individual `castVote` no
   longer leaks its choice. (You are now describing homomorphic / committed
   tallies, a genuinely different and harder contract. Naming the change is
   enough.)

---

## 10. Credits & references

- The simulator and phase-1 testing pattern is **adapted from the official
  [`midnightntwrk/example-counter`](https://github.com/midnightntwrk/example-counter)**;
  its copyright notice is preserved in this workspace's `vitest.config.ts`.
- `persistentHash`, `pad`, `Counter`, `Set`, `Opaque`, `Bytes`, `Vector`, and
  `blockTimeGt` come from `CompactStandardLibrary`.
- Nullifiers, commitments, and selective disclosure:
  <https://docs.midnight.network/develop/reference/compact/lang-ref>
- Runtime types (`CircuitContext`, `QueryContext`, `WitnessContext`, `ledger`,
  and friends) come from `@midnight-ntwrk/compact-runtime`.
```
