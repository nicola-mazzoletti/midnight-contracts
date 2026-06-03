# Unshielded Token

The public sibling of the [shielded token](../shielded-token-contract/docs.md).
These circuits move **unshielded** tokens: amounts, types, and recipients are all
visible on-chain. This is the side of Midnight where NIGHT, the native token,
lives. If the shielded contract is cash in sealed envelopes, this one is chips
slid across an open counter.

The five circuits here are ported **verbatim** from Midnight's official
token-transfers contract, which lives at
[`midnightntwrk/midnight-wallet-dapp`](https://github.com/midnightntwrk/midnight-wallet-dapp)
(`src/contract/contracts/token-transfers.compact`) and is rendered in the
[docs](https://docs.midnight.network/examples/contracts/token-transfers). That
upstream file holds nine circuits; this workspace takes the five **unshielded**
ones, and [`shielded-token-contract`](../shielded-token-contract/docs.md) takes
the four shielded ones. The circuit bodies are unchanged. The only addition is a
`pragma` line (a version pin; the upstream omits it and compiles either way).

---

## 1. What this contract does

It is a small library of the core unshielded-token operations. Like its shielded
sibling, it holds **no ledger state of its own**; each circuit creates, sends, or
receives tokens.

| Circuit | What it does |
|---------|--------------|
| `mintAndReceive(amount)` | mint the contract's custom token to itself, returns the token color |
| `sendToUser(amount, user)` | send the custom token to a user |
| `receiveTokens(amount)` | receive the custom token |
| `receiveNightTokens(amount)` | receive the native **NIGHT** token (the default color) |
| `sendNightTokensToUser(amount, user)` | send native **NIGHT** to a user |

Two of the five operate on the contract's own custom token; two operate on
native **NIGHT**; one mints. Together they show the difference between a
contract's own token and the chain's native money, both on the public side.

---

## 2. Run it in 60 seconds

```bash
# from the repo root
npm install

# from this workspace
cd unshielded-token-contract
npm run compact      # compile token.compact into src/managed/token/
npm test             # run the Vitest suite
```

No node, wallet, or proof server. The suite runs in memory.

> **Tip:** `npm run compact-fast` skips zero-knowledge key generation
> (`--skip-zk`) for faster iteration.

---

## 3. The contract, line by line

`src/token.compact` (verbatim circuits; doc-comments trimmed):

```compact
pragma language_version >= 0.23;
import CompactStandardLibrary;

export circuit mintAndReceive(amount: Uint<64>): Bytes<32> {
    const domain = pad(32, "simple:receive");
    const color = mintUnshieldedToken(
        disclose(domain), disclose(amount),
        left<ContractAddress, UserAddress>(kernel.self()));
    return color;
}

export circuit sendToUser(amount: Uint<64>, user_addr: UserAddress): [] {
    const domain = pad(32, "simple:receive");
    const color = tokenType(disclose(domain), kernel.self());
    sendUnshielded(color, disclose(amount) as Uint<128>,
        right<ContractAddress, UserAddress>(disclose(user_addr)));
}

export circuit receiveTokens(amount: Uint<128>): [] {
    const domain = pad(32, "simple:receive");
    const color = tokenType(domain, kernel.self());
    receiveUnshielded(color, disclose(amount));
}

export circuit receiveNightTokens(amount: Uint<128>): [] {
   receiveUnshielded(default<Bytes<32>>, disclose(amount));
}

export circuit sendNightTokensToUser(amount: Uint<64>, user_addr: UserAddress): [] {
    sendUnshielded(default<Bytes<32>>, disclose(amount) as Uint<128>,
        right<ContractAddress, UserAddress>(disclose(user_addr)));
}
```

The unshielded vocabulary, all from `CompactStandardLibrary`:

**A token's "color" is its identity.** Every token type has a 32-byte color
(`Bytes<32>`). A contract's *custom* token color is `tokenType(pad(32, "simple:receive"), kernel.self())`:
a domain tag plus the contract's own address. The all-zero color,
`default<Bytes<32>>`, is the **native NIGHT** token. That single difference,
custom color vs. `default`, is what separates the two pairs of circuits here.

**`mintUnshieldedToken(domainSep, value, recipient)`** creates `value` units of
the custom token and returns its color. The recipient is an
`Either<ContractAddress, UserAddress>`: `left(...)` is a contract (here
`kernel.self()`), `right(...)` is a user. (Note: this order is the *reverse* of
the shielded contract's `Either<ZswapCoinPublicKey, ContractAddress>`, so read
the type parameters rather than memorizing left/right.)

**`sendUnshielded(color, amount, recipient)`** moves `amount` of an existing
token. Note `amount` is `Uint<128>`, wider than the `Uint<64>` mint, hence the
`as Uint<128>` casts.

**`receiveUnshielded(color, amount)`** claims `amount` of an incoming token.

**`disclose(...)` on every input.** Feeding a circuit parameter into a token
operation crosses the private-to-public boundary, so it is disclosed.

---

## 4. Public, and only as real as the transaction

Unlike the shielded contract, nothing here is hidden: the colors, amounts, and
recipient addresses are all public. There are no commitments and no change
coins, because there is nothing to conceal and (in these demo circuits) no coin
object to split.

The same phase-1 honesty applies, though. The in-memory simulator **executes
circuit logic but does not balance transactions**, so `sendToUser` and
`receiveTokens` run even with no real holdings. Conservation, that you cannot
send tokens you do not have, is enforced when a transaction is **balanced and
validated on the network** (phase-2: node + proof server), not by these
circuits.

| Layer | What it checks | Phase-1 can test? |
|-------|----------------|-------------------|
| circuit logic, returned color | the API behaves | yes |
| you actually hold the tokens you send | conservation | no, phase-2 |

So the tests assert what is honest at phase-1: that minting returns a 32-byte
color, that it is deterministic, and that each circuit runs. They do not pretend
the tokens really moved.

---

## 5. Unshielded vs. shielded (the pair)

Read this next to [`shielded-token-contract`](../shielded-token-contract/docs.md);
they are the two privacy domains of the same official example file.

| | Unshielded (this one) | Shielded |
|---|---|---|
| mint | `mintUnshieldedToken` | `mintShieldedToken` |
| send | `sendUnshielded` | `sendShielded` |
| receive | `receiveUnshielded` | `receiveShielded` |
| amount | a plain `Uint` | inside a `ShieldedCoinInfo` |
| on-chain you see | amounts and addresses | only a commitment |
| `Either` order | `Either<ContractAddress, UserAddress>` | `Either<ZswapCoinPublicKey, ContractAddress>` |

NIGHT is unshielded, which is why the native-token circuits (`receiveNightTokens`,
`sendNightTokensToUser`) live here and not in the shielded contract.

---

## 6. What the compiler generates

`npm run compact` writes `src/managed/token/` (generated; never commit). The API:

```ts
export type Ledger = {};   // no on-chain state

export type ImpureCircuits<PS> = {
  mintAndReceive(ctx, amount_0: bigint): CircuitResults<PS, Uint8Array>;  // returns the color
  sendToUser(ctx, amount_0: bigint, user_addr_0: { bytes: Uint8Array }): CircuitResults<PS, []>;
  receiveTokens(ctx, amount_0: bigint): CircuitResults<PS, []>;
  receiveNightTokens(ctx, amount_0: bigint): CircuitResults<PS, []>;
  sendNightTokensToUser(ctx, amount_0: bigint, user_addr_0: { bytes: Uint8Array }): CircuitResults<PS, []>;
}
```

`Uint<64>`/`Uint<128>` become `bigint`, `Bytes<32>` (the returned color) becomes
`Uint8Array`, and `UserAddress` becomes `{ bytes: Uint8Array }`. The `Ledger` is
empty: this contract stores nothing, it only operates on tokens.

---

## 7. The simulator

`src/test/simulators/simulator.ts` defines `TokenSimulator`, the lean
no-ledger-state variant (adapted from the official
[`midnightntwrk/example-counter`](https://github.com/midnightntwrk/example-counter)
harness pattern, credited in `vitest.config.ts`). One method per circuit; each
executes the circuit and returns its result.

```ts
const sim = TokenSimulator.deploy();
const color = sim.mintAndReceive(100n);   // -> Uint8Array (the token color)
sim.sendToUser(30n, aliceAddress);
sim.receiveNightTokens(5n);
```

---

## 8. The tests

`src/test/token.test.ts` has six tests, asserting only what phase-1 can honestly
verify:

```ts
it("mints the custom token and returns a 32-byte color", () => {
  const color = sim.mintAndReceive(100n);
  expect(color.length).toEqual(32);
});

it("mints a deterministic color (the domain tag is fixed in the circuit)", () => {
  const first = sim.mintAndReceive(10n);
  const second = sim.mintAndReceive(10n);
  expect(second).toEqual(first);   // same contract + "simple:receive" tag => same color
});

it("sends the native NIGHT token to a user", () => {
  expect(() => sim.sendNightTokensToUser(5n, bob)).not.toThrow();
});
```

The rest confirm `sendToUser`, `receiveTokens`, and `receiveNightTokens` run.
Notice what is not asserted: that the tokens truly moved. That is the phase-2
property.

---

## 9. Try it yourself

Recompile (`npm run compact-fast`) and re-test after each change.

1. **Custom vs. native.** `mintAndReceive` and `receiveTokens` use the custom
   color (`tokenType("simple:receive", self)`); `receiveNightTokens` uses
   `default<Bytes<32>>`. Confirm in a test that the minted color is *not* all
   zeroes. What does the all-zero color mean?
2. **Feel the phase boundary.** Call `sendToUser(1000000n, alice)` on a fresh
   contract that never minted. It runs. What does that tell you about what the
   simulator does and does not enforce, and where the real check lives?
3. **Change the tag.** The domain tag `"simple:receive"` is hardcoded in the
   circuit, so every mint produces the same color. If you changed it, what would
   change about the token's identity, and what is the tag protecting against
   across contracts?
4. **Compare to shielded.** Open the shielded sibling and line up `sendUnshielded`
   against `sendShielded`. Why does the shielded one return a `change` coin while
   this one returns nothing? (Hint: coin objects vs. plain amounts.)

---

## 10. Credits & references

- The five circuits are **verbatim** from Midnight's official token-transfers
  contract: [`midnightntwrk/midnight-wallet-dapp`](https://github.com/midnightntwrk/midnight-wallet-dapp)
  (`src/contract/contracts/token-transfers.compact`), also rendered in the
  [docs](https://docs.midnight.network/examples/contracts/token-transfers). There
  the contract is driven by a React wallet UI; what this workspace adds is the
  phase-1 simulator + Vitest harness so the circuits can be unit-tested in
  isolation. Function signatures come from the
  [Compact standard library](https://docs.midnight.network/compact/standard-library/exports).
- The simulator pattern is adapted from the official
  [`midnightntwrk/example-counter`](https://github.com/midnightntwrk/example-counter);
  its copyright notice is preserved in this workspace's `vitest.config.ts`.
- Background on Midnight's token and UTXO model:
  <https://docs.midnight.network/concepts/utxo>.
