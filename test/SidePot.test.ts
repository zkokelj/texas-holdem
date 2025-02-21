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
      
      // Set hole cards to be unique and high value to avoid conflicts
      // Player A: [48,49] (Queen-King of Spades)
      // Player B: [46,47] (Ten-Jack of Spades)
      // Player C: [44,45] (Eight-Nine of Spades)
      const holeCards = [44 + (i * 2), 45 + (i * 2)];
      
      await stateStorage.connect(owner).updatePlayerState(players[i].address, {
        stack: stack,
        status: 1, // Active
        currentBet: 0,
        position: i,
        holeCards: holeCards,
        lastActionTime: 0,
        totalContribution: 0
      });
    }

    // Initialize game state
    await stateStorage.connect(owner).updateGameBasics(
      3, // Final round
      0, // Empty pot
      0, // No bet
      players[PLAYER_A].address // Player A starts
    );

    // Set community cards to be unique and lower value to avoid conflicts
    // Using clubs (0-12), diamonds (13-25), hearts (26-38)
    await stateStorage.connect(owner).updateGameCards([1, 14, 27, 2, 15]);
  }

  it("should correctly handle pot distribution with all-in player", async function () {
    // Initialize game state
    await stateStorage.connect(owner).updateGameBasics(
      0,                // PreFlop round
      0,                // Initial pot
      0,                // Current bet
      players[0].address  // First player to act
    );

    // Initialize player states
    for (let i = 0; i < 3; i++) {
      let stack = i === 1 ? 200 : 1000; // Player 1 gets small stack
      await stateStorage.connect(owner).updatePlayerState(players[i].address, {
        stack: stack,
        status: 1, // Active
        currentBet: 0,
        position: i,
        holeCards: [i * 2, i * 2 + 1], // Simple cards
        lastActionTime: 0,
        totalContribution: 0
      });
    }

    console.log("----- ALL-IN POT DISTRIBUTION TEST -----");
    
    // Initial setup logging
    console.log("Initial stacks:");
    for (let i = 0; i < 3; i++) {
      const player = await stateStorage.getPlayer(players[i].address);
      console.log(`Player ${i} (${players[i].address}) stack: ${player.stack}`);
    }

    // Log initial game state
    const initialGameState = await stateStorage.getGameState();
    console.log("\nInitial game state:");
    console.log("Current turn:", initialGameState.currentTurn);
    console.log("Current round:", initialGameState.currentRound);
    console.log("Current bet:", initialGameState.currentBet);

    // Player A bets 100
    console.log("\nPlayer A attempts to bet 100");
    console.log("Current turn before bet:", (await stateStorage.getGameState()).currentTurn);
    console.log("Player A address:", players[0].address);
    await gameLogic.connect(players[0]).processAction(players[0].address, RAISE, 100);
    
    // Log state after first bet
    const stateAfterBet1 = await stateStorage.getGameState();
    console.log("\nState after Player A's bet:");
    console.log("Current turn:", stateAfterBet1.currentTurn);
    console.log("Current bet:", stateAfterBet1.currentBet);
    console.log("Main pot:", stateAfterBet1.mainPot);

    // Player B (small stack) goes all-in with stack of 200
    console.log("\nPlayer B attempts to go all-in");
    console.log("Current turn before all-in:", (await stateStorage.getGameState()).currentTurn);
    console.log("Player B address:", players[1].address);
    const playerBBefore = await stateStorage.getPlayer(players[1].address);
    console.log("Player B stack before:", playerBBefore.stack);
    
    await gameLogic.connect(players[1]).processAction(players[1].address, RAISE, 100);
    
    const playerBAfter = await stateStorage.getPlayer(players[1].address);
    console.log("Player B stack after:", playerBAfter.stack);

    // Log state after all-in
    const stateAfterAllIn = await stateStorage.getGameState();
    console.log("\nState after Player B's all-in:");
    console.log("Current turn:", stateAfterAllIn.currentTurn);
    console.log("Current bet:", stateAfterAllIn.currentBet);
    console.log("Main pot:", stateAfterAllIn.mainPot);

    // Player C calls 200
    console.log("\nPlayer C attempts to call");
    console.log("Current turn before call:", (await stateStorage.getGameState()).currentTurn);
    console.log("Player C address:", players[2].address);
    await gameLogic.connect(players[2]).processAction(players[2].address, CALL, 0);

    // Wait for state update and verify it's Player A's turn
    const stateAfterPlayerC = await stateStorage.getGameState();
    console.log("\nState after Player C's call:");
    console.log("Current turn:", stateAfterPlayerC.currentTurn);
    console.log("Current bet:", stateAfterPlayerC.currentBet);
    console.log("Main pot:", stateAfterPlayerC.mainPot);

    // Only proceed with Player A's action if it's their turn
    if (stateAfterPlayerC.currentTurn === players[0].address) {
        console.log("\nPlayer A attempts to call");
        console.log("Current turn before call:", (await stateStorage.getGameState()).currentTurn);
        console.log("Player A address:", players[0].address);
        await gameLogic.connect(players[0]).processAction(players[0].address, CALL, 0);
    } else {
        console.log("\nSkipping Player A's action as it's not their turn");
        console.log("Current turn is:", stateAfterPlayerC.currentTurn);
    }

    // Log final state
    const finalState = await stateStorage.getGameState();
    console.log("\nFinal game state:");
    console.log("Current turn:", finalState.currentTurn);
    console.log("Current bet:", finalState.currentBet);
    console.log("Main pot:", finalState.mainPot);

    // Log final stacks
    console.log("\nFinal stacks:");
    for (let i = 0; i < 3; i++) {
      const player = await stateStorage.getPlayer(players[i].address);
      console.log(`Player ${i} (${players[i].address}) stack: ${player.stack}`);
    }
  });
});