import { TokenSimulator, logger } from "./simulators/simulator.js";
import { describe, it, expect } from "vitest";
import * as utils from "./utils/utils";

// The caller that "deploys" the contract.
export const deployer = utils.toHexPadded("deployer");

// Two example user addresses to send to.
const alice = utils.userAddress("alice");
const bob = utils.userAddress("bob");

describe("Unshielded token circuits", () => {
  it("mints the custom token and returns a 32-byte color", () => {
    const sim = TokenSimulator.deploy();
    const color = sim.mintAndReceive(100n);
    expect(color).toBeInstanceOf(Uint8Array);
    expect(color.length).toEqual(32);
  });

  it("mints a deterministic color (the domain tag is fixed in the circuit)", () => {
    const sim = TokenSimulator.deploy();
    const first = sim.mintAndReceive(10n);
    const second = sim.mintAndReceive(10n);
    // Same contract + same hardcoded "simple:receive" tag => same token color.
    expect(second).toEqual(first);
  });

  it("sends the custom token to a user", () => {
    const sim = TokenSimulator.deploy();
    expect(() => sim.sendToUser(30n, alice)).not.toThrow();
  });

  it("receives the custom token", () => {
    const sim = TokenSimulator.deploy();
    expect(() => sim.receiveTokens(40n)).not.toThrow();
  });

  it("receives the native NIGHT token (default color)", () => {
    const sim = TokenSimulator.deploy();
    expect(() => sim.receiveNightTokens(5n)).not.toThrow();
  });

  it("sends the native NIGHT token to a user", () => {
    const sim = TokenSimulator.deploy();
    expect(() => sim.sendNightTokensToUser(5n, bob)).not.toThrow();

    logger.info({ section: "after NIGHT send", ledger: sim.getLedger() });
  });
});
