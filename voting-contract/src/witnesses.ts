// Private state for the voting contract.
export type VotingPrivateState = {
  secretKey: Uint8Array;
};

export const createPrivateState = (secretKey: Uint8Array): VotingPrivateState => {
  return {
    secretKey,
  };
};

// Witness context type
type WitnessContext<T> = {
  privateState: T;
};

// Witness implementations - these run locally and provide private data to circuits.
// Each witness returns a [nextPrivateState, result] tuple.
export const witnesses = {
  // Provides the caller's secret key. Used both to derive the owner commitment
  // and to derive a per-voter nullifier. The private state is returned unchanged.
  local_secret_key: (context: WitnessContext<VotingPrivateState>): [VotingPrivateState, Uint8Array] => {
    return [context.privateState, context.privateState.secretKey];
  },
};
