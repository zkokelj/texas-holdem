import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("GameLogic - Simple Side Pot Test", function () {
  // Contract instances
  let gameLogic: any;
  let stateStorage: any;
  let handManager: any;
  let handEvaluator: any;
  let owner: SignerWithAddress;
  let players: SignerWithAddress[];

  // Action constants
  const FOLD = 0;
  const CHECK = 1;
  const CALL = 2;
  const RAISE = 3;

  // Simplified setup with just 3 players
  const PLAYER_A = 0; // Normal stack
  const PLAYER_B = 1; // Small stack (will go all-in)
  const PLAYER_C = 2; // Normal stack

  // Stack sizes
  const NORMAL_STACK = 1000;
  const SMALL_STACK = 200;
  
  beforeEach(async function () {
    // Get signers
    [owner, ...players] = await ethers.getSigners();

    // Deploy contracts
    const StateStorage = await ethers.getContractFactory("StateStorage");
    stateStorage = await (await StateStorage.connect(owner).deploy()).waitForDeployment();

    const HandManager = await ethers.getContractFactory("HandManager");
    handManager = await (await HandManager.connect(owner).deploy(stateStorage.getAddress())).waitForDeployment();

    const HandEvaluator = await ethers.getContractFactory("HandEvaluator");
    handEvaluator = await (await HandEvaluator.connect(owner).deploy()).waitForDeployment();

    const GameLogic = await ethers.getContractFactory("GameLogic");
    gameLogic = await (await GameLogic.connect(owner).deploy(
      stateStorage.getAddress(),
      handManager.getAddress(),
      handEvaluator.getAddress()
    )).waitForDeployment();

    // Set permissions
    await stateStorage.connect(owner).authorizeContract(gameLogic.getAddress());
    await stateStorage.connect(owner).authorizeContract(handManager.getAddress());
    await stateStorage.connect(owner).authorizeContract(owner.address);

    // Setup players with different stacks
    await setupThreePlayerGame();
  });

  async function setupThreePlayerGame() {
    // Set up three players with specified stacks
    for (let i = 0; i < 3; i++) {
      const stack = i === PLAYER_B ? SMALL_STACK : NORMAL_STACK;
      
      // Set hole cards (values don't matter for this test)
      const holeCards = [i * 2, i * 2 + 1];
      
      await stateStorage.connect(owner).updatePlayerState(players[i].address, {
        stack: stack,
        status: 1, // Active
        currentBet: 0,
        position: i,
        holeCards: holeCards,
        lastActionTime: 0
      });
    }

    // Initialize game state
    await stateStorage.connect(owner).updateGameBasics(
      3, // Final round
      0, // Empty pot
      0, // No bet
      players[PLAYER_A].address // Player A starts
    );
  }

  it("should create a side pot when a player goes all-in", async function () {
    console.log("\n----- SIMPLE SIDE POT TEST -----");
    
    // Log initial stacks
    console.log("Initial stacks:");
    for (let i = 0; i < 3; i++) {
        const player = await stateStorage.getPlayer(players[i].address);
        console.log(`Player ${i} (${players[i].address}) stack: ${player.stack}`);
    }
    
    // Player A bets 100
    console.log("\nPlayer A bets 100");
    await gameLogic.connect(players[PLAYER_A]).processAction(players[PLAYER_A].address, RAISE, 100);
    
    // Player B (small stack) goes all-in
    console.log("Player B (small stack) goes all-in");
    const playerBBeforeBet = await stateStorage.getPlayer(players[PLAYER_B].address);
    await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, RAISE, 100);
    const playerBAfterBet = await stateStorage.getPlayer(players[PLAYER_B].address);
    
    // Verify Player B is all-in
    console.log(`Player B stack before: ${playerBBeforeBet.stack}, after: ${playerBAfterBet.stack}`);
    expect(playerBAfterBet.stack).to.equal(BigInt(0));
    
    // Player C calls and raises (creating side pot)
    console.log("Player C calls and raises to 300");
    await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, RAISE, 200);
    
    // Player A calls the raise
    console.log("Player A calls 300");
    await gameLogic.connect(players[PLAYER_A]).processAction(players[PLAYER_A].address, CALL, 0);
    
    // Check pot status
    console.log("\n----- VERIFYING POTS -----");
    const gameState = await stateStorage.getGameState();
    console.log(`Main pot: ${gameState.mainPot}`);
    
    // Verify side pot was created
    const sidePotsCount = await stateStorage.sidePotCount();
    console.log(`Number of side pots: ${sidePotsCount}`);
    expect(sidePotsCount).to.equal(BigInt(1)); // Exactly one side pot
    
    if (sidePotsCount > 0) {
      const sidePot = await stateStorage.getSidePot(0);
      console.log(`Side pot amount: ${sidePot[0]}, Resolved: ${sidePot[1]}`);
      
      // Calculate expected side pot
      // Each player contributed Player B's max (200) to main pot
      // Side pot should have the excess: (300-200) from Player A and C = 200
      const expectedSidePot = BigInt(200);
      console.log(`Expected side pot: ${expectedSidePot}`);
      
      expect(sidePot[0]).to.equal(expectedSidePot);
      expect(sidePot[1]).to.be.false; // Not resolved yet
    }
    
    // Verify eligibility
    console.log("\n----- CHECKING ELIGIBILITY -----");
    // All players eligible for main pot
    for (let i = 0; i < 3; i++) {
      const mainPotEligible = await stateStorage.isPlayerEligibleForPot(0, players[i].address);
      console.log(`Player ${i} eligible for main pot: ${mainPotEligible}`);
      expect(mainPotEligible).to.be.true;
    }
    
    // Only A and C eligible for side pot
    if (sidePotsCount > 0) {
      for (let i = 0; i < 3; i++) {
        const sidePotEligible = await stateStorage.isPlayerEligibleForPot(1, players[i].address);
        console.log(`Player ${i} eligible for side pot: ${sidePotEligible}`);
        
        if (i === PLAYER_B) {
          expect(sidePotEligible).to.be.false;
        } else {
          expect(sidePotEligible).to.be.true;
        }
      }
    }
    
    // Verify final stacks
    console.log("\n----- FINAL STACKS -----");
    for (let i = 0; i < 3; i++) {
      const player = await stateStorage.getPlayer(players[i].address);
      console.log(`Player ${i} final stack: ${player.stack}`);
    }
  });
});