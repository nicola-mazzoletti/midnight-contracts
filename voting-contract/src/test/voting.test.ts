import { VotingSimulator, logger } from "./simulators/simulator.js";
import { ProposalState, VoteChoice } from "../managed/voting/contract/index.js";
import { describe, it, expect } from "vitest";
import * as utils from "./utils/utils";

// Secret keys (32 bytes each)
const ownerSk = utils.randomBytes(32);
const voter1Sk = utils.randomBytes(32);
const voter2Sk = utils.randomBytes(32);

// Participant identifiers for the simulator. `owner` is also used as the
// deploying account's coin public key (see simulator.ts).
export const owner = utils.toHexPadded("owner");
export const voter1 = utils.toHexPadded("voter1");
export const voter2 = utils.toHexPadded("voter2");

const TITLE = "Adopt proposal X?";
const DESCRIPTION = "Should the DAO adopt proposal X next quarter?";
const ENDING_TIME = 1000n; // seconds since epoch

function createSimulator() {
  const simulator = VotingSimulator.deployContract(
    ownerSk,
    TITLE,
    DESCRIPTION,
    ENDING_TIME
  );
  simulator.createPrivateState("voter1", voter1Sk);
  simulator.createPrivateState("voter2", voter2Sk);
  return simulator;
}

describe("Voting smart contract", () => {
  it("should start in setup with the proposal recorded and zero tallies", () => {
    const simulator = createSimulator();
    const ledger = simulator.as("owner").getLedger();

    expect(ledger.phase).toEqual(ProposalState.SETUP);
    expect(ledger.title).toEqual(TITLE);
    expect(ledger.description).toEqual(DESCRIPTION);
    expect(ledger.yesVotes).toEqual(0n);
    expect(ledger.noVotes).toEqual(0n);
    expect(ledger.abstainVotes).toEqual(0n);
    expect(ledger.voteEndingTime).toEqual(ENDING_TIME);

    logger.info({
      section: "Initial State",
      phase: ledger.phase,
      title: ledger.title
    });
  });

  it("should only let the owner open voting", () => {
    const simulator = createSimulator();

    expect(() => {
      simulator.as("voter1").openVoting();
    }).toThrow("Only the owner can open voting");
  });

  it("should let the owner open voting", () => {
    const simulator = createSimulator();

    const ledger = simulator.as("owner").openVoting();
    expect(ledger.phase).toEqual(ProposalState.OPEN);
  });

  it("should not allow opening voting twice", () => {
    const simulator = createSimulator();
    simulator.as("owner").openVoting();

    expect(() => {
      simulator.as("owner").openVoting();
    }).toThrow("Voting can only be opened from the setup phase");
  });

  it("should reject votes before voting is open", () => {
    const simulator = createSimulator();

    expect(() => {
      simulator.as("voter1").castVote(VoteChoice.YES);
    }).toThrow("Voting is not open");
  });

  it("should tally votes against the correct choice", () => {
    const simulator = createSimulator();
    simulator.as("owner").openVoting();
    simulator.setBlockTime(ENDING_TIME - 1n); // before the deadline

    let ledger = simulator.as("voter1").castVote(VoteChoice.YES);
    expect(ledger.yesVotes).toEqual(1n);

    ledger = simulator.as("voter2").castVote(VoteChoice.NO);
    expect(ledger.noVotes).toEqual(1n);
    expect(ledger.yesVotes).toEqual(1n);
    expect(ledger.abstainVotes).toEqual(0n);

    logger.info({
      section: "Tallies",
      yes: ledger.yesVotes,
      no: ledger.noVotes,
      abstain: ledger.abstainVotes
    });
  });

  it("should let a voter abstain", () => {
    const simulator = createSimulator();
    simulator.as("owner").openVoting();
    simulator.setBlockTime(ENDING_TIME - 1n);

    const ledger = simulator.as("voter1").castVote(VoteChoice.ABSTAIN);
    expect(ledger.abstainVotes).toEqual(1n);
  });

  it("should prevent the same voter from voting twice", () => {
    const simulator = createSimulator();
    simulator.as("owner").openVoting();
    simulator.setBlockTime(ENDING_TIME - 1n);

    simulator.as("voter1").castVote(VoteChoice.YES);

    expect(() => {
      simulator.as("voter1").castVote(VoteChoice.NO);
    }).toThrow("This voter has already voted");
  });

  it("should reject votes after the ending time", () => {
    const simulator = createSimulator();
    simulator.as("owner").openVoting();
    simulator.setBlockTime(ENDING_TIME + 1n); // past the deadline

    expect(() => {
      simulator.as("voter1").castVote(VoteChoice.YES);
    }).toThrow("Voting period has ended");
  });

  it("should not allow closing voting before the ending time", () => {
    const simulator = createSimulator();
    simulator.as("owner").openVoting();
    simulator.setBlockTime(ENDING_TIME - 1n); // before the deadline

    expect(() => {
      simulator.as("owner").closeVoting();
    }).toThrow("Voting cannot be closed before the ending time");
  });

  it("should only let the owner close voting", () => {
    const simulator = createSimulator();
    simulator.as("owner").openVoting();
    simulator.setBlockTime(ENDING_TIME + 1n);

    expect(() => {
      simulator.as("voter1").closeVoting();
    }).toThrow("Only the owner can close voting");
  });

  it("should let the owner close voting after the ending time and freeze tallies", () => {
    const simulator = createSimulator();
    simulator.as("owner").openVoting();
    simulator.setBlockTime(ENDING_TIME - 1n);
    simulator.as("voter1").castVote(VoteChoice.YES);

    simulator.setBlockTime(ENDING_TIME + 1n);
    let ledger = simulator.as("owner").closeVoting();
    expect(ledger.phase).toEqual(ProposalState.CLOSED);
    expect(ledger.yesVotes).toEqual(1n);

    // No more votes once closed.
    expect(() => {
      simulator.as("voter2").castVote(VoteChoice.NO);
    }).toThrow("Voting is not open");

    logger.info({
      section: "After Close",
      phase: ledger.phase,
      yes: ledger.yesVotes
    });
  });
});
