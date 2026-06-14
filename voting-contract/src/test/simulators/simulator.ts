import { createLogger } from "../../logger.js";
import { LogicTestingConfig } from "../../config.js";
import { owner } from "../voting.test.js";

import {
  Contract,
  type Ledger,
  ledger,
  VoteChoice
} from "../../managed/voting/contract/index.js";
import {
  type VotingPrivateState,
  createPrivateState,
  witnesses
} from "../../witnesses.js";

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
  CircuitResults,
  CoinPublicKey,
  emptyZswapLocalState,
  ContractAddress
} from "@midnight-ntwrk/compact-runtime";

const config = new LogicTestingConfig();
export const logger = await createLogger(config.logDir);

export class VotingSimulator {
  readonly contract: Contract<VotingPrivateState>;
  circuitContext: CircuitContext<VotingPrivateState>;
  userPrivateStates: Record<string, VotingPrivateState>;
  updateUserPrivateState: (newPrivateState: VotingPrivateState) => void;
  contractAddress: ContractAddress;

  constructor(
    privateState: VotingPrivateState,
    title: string,
    description: string,
    voteEndingTime: bigint
  ) {
    this.contract = new Contract<VotingPrivateState>(witnesses);
    this.contractAddress = sampleContractAddress();
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState
    } = this.contract.initialState(
      createConstructorContext({ secretKey: privateState.secretKey }, owner),
      title,
      description,
      voteEndingTime
    );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      currentQueryContext: new QueryContext(
        currentContractState.data,
        this.contractAddress
      ),
      costModel: CostModel.initialCostModel()
    };
    // The deployer is the owner.
    this.userPrivateStates = { ["owner"]: currentPrivateState };
    this.updateUserPrivateState = (_newPrivateState: VotingPrivateState) => {};
  }

  static deployContract(
    secretKey: Uint8Array,
    title: string,
    description: string,
    voteEndingTime: bigint
  ): VotingSimulator {
    return new VotingSimulator(
      createPrivateState(secretKey),
      title,
      description,
      voteEndingTime
    );
  }

  // Register another participant (e.g. a voter) with their own secret key.
  createPrivateState(userName: string, secretKey: Uint8Array): void {
    this.userPrivateStates[userName] = createPrivateState(secretKey);
  }

  private buildTurnContext(
    currentPrivateState: VotingPrivateState
  ): CircuitContext<VotingPrivateState> {
    return {
      ...this.circuitContext,
      currentPrivateState
    };
  }

  private updateUserPrivateStateByName =
    (name: string) =>
    (newPrivateState: VotingPrivateState): void => {
      this.userPrivateStates[name] = newPrivateState;
    };

  // Switch the active caller. Subsequent circuit calls use this user's secret
  // key (which drives both the owner check and the per-voter nullifier).
  as(name: string): VotingSimulator {
    const ps = this.userPrivateStates[name];
    if (!ps) {
      throw new Error(
        `No private state found for user '${name}'. Did you register it?`
      );
    }
    this.circuitContext = this.buildTurnContext(ps);
    this.updateUserPrivateState = this.updateUserPrivateStateByName(name);
    return this;
  }

  // Set the simulated block time (seconds since the UNIX epoch). The contract's
  // blockTimeGt(voteEndingTime) checks in castVote/closeVoting read this value.
  // Call it immediately before a time-sensitive circuit, since each circuit call
  // produces a fresh context.
  setBlockTime(secondsSinceEpoch: bigint): VotingSimulator {
    const qc = this.circuitContext.currentQueryContext;
    qc.block = { ...qc.block, secondsSinceEpoch, secondsSinceEpochErr: 0 };
    return this;
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public getPrivateState(): VotingPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public getCircuitContext(): CircuitContext<VotingPrivateState> {
    return this.circuitContext;
  }

  updateStateAndGetLedger<T>(
    circuitResults: CircuitResults<VotingPrivateState, T>
  ): Ledger {
    this.circuitContext = circuitResults.context;
    this.updateUserPrivateState(circuitResults.context.currentPrivateState);
    return this.getLedger();
  }

  public openVoting(sender?: CoinPublicKey): Ledger {
    const circuitResults = this.contract.impureCircuits.openVoting({
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState
    });

    logger.info("OPEN VOTING CIRCUIT");
    logger.info({
      section: "Circuit Results",
      gasCost: circuitResults.gasCost,
      result: circuitResults.result
    });

    return this.updateStateAndGetLedger(circuitResults);
  }

  public closeVoting(sender?: CoinPublicKey): Ledger {
    const circuitResults = this.contract.impureCircuits.closeVoting({
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState
    });

    logger.info("CLOSE VOTING CIRCUIT");
    logger.info({
      section: "Circuit Results",
      gasCost: circuitResults.gasCost,
      result: circuitResults.result
    });

    return this.updateStateAndGetLedger(circuitResults);
  }

  public castVote(choice: VoteChoice, sender?: CoinPublicKey): Ledger {
    const circuitResults = this.contract.impureCircuits.castVote(
      {
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState
      },
      choice
    );

    logger.info("CAST VOTE CIRCUIT");
    logger.info({
      section: "Circuit Results",
      gasCost: circuitResults.gasCost,
      result: circuitResults.result
    });

    return this.updateStateAndGetLedger(circuitResults);
  }
}
