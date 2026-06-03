// This contract uses no witnesses: all of its inputs are public circuit
// parameters and its state lives entirely in the public ledger. We still
// declare a (trivial) private-state type so the test harness has something to
// thread through, mirroring the other contracts in this repo.
export type TokenPrivateState = {
  readonly _unused: number;
};

export const createPrivateState = (value: number): TokenPrivateState => {
  return { _unused: value };
};

export const witnesses = {};
