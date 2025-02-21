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
    console.log("\n----- ALL-IN POT DISTRIBUTION TEST -----");
    
    // Set up player stacks for testing
    // Give Player B a smaller stack to force all-in
    await stateStorage.connect(owner).updatePlayerState(players[PLAYER_B].address, {
      stack: 200,
      status: 1, // Active
      currentBet: 0,
      position: PLAYER_B,
      holeCards: [12, 13], // Some cards
      lastActionTime: 0,
      totalContribution: 0
    });
    
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
    console.log("Player B (small stack) goes all-in with stack of 200");
    const playerBBeforeBet = await stateStorage.getPlayer(players[PLAYER_B].address);
    await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, RAISE, 100);
    const playerBAfterBet = await stateStorage.getPlayer(players[PLAYER_B].address);
    
    // Verify Player B is all-in
    console.log(`Player B stack before: ${playerBBeforeBet.stack}, after: ${playerBAfterBet.stack}`);
    expect(playerBAfterBet.stack).to.equal(0);
    expect(playerBAfterBet.status).to.equal(4); // AllIn status
    
    // Player C calls
    console.log("Player C calls 200");
    await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CALL, 0);
    
    // Player A calls
    console.log("Player A calls 200");
    await gameLogic.connect(players[PLAYER_A]).processAction(players[PLAYER_A].address, CALL, 0);
    
    // Check game state after betting
    const gameStateAfterBetting = await stateStorage.getGameState();
    console.log(`Main pot after betting: ${gameStateAfterBetting.mainPot}`);
    expect(gameStateAfterBetting.mainPot).to.equal(600); // 200 * 3 players
    
    // Verify contributions
    for (let i = 0; i < 3; i++) {
      const player = await stateStorage.getPlayer(players[i].address);
      console.log(`Player ${i} contributed: ${player.totalContribution}`);
      expect(player.totalContribution).to.equal(200); // All should contribute 200
    }
    
    // Mock dealing community cards to complete the hand
    // Skip to showdown by dealing flop, turn, river
    await stateStorage.connect(owner).updateGameBasics(
      1, // BettingRound.Flop
      600, // mainPot
      0, // currentBet
      players[PLAYER_A].address // currentTurn
    );
    
    // Players check through the hand
    await gameLogic.connect(players[PLAYER_A]).processAction(players[PLAYER_A].address, CHECK, 0);
    await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);
    
    // Now on turn
    await stateStorage.connect(owner).updateGameBasics(
      2, // BettingRound.Turn
      600, // mainPot
      0, // currentBet
      players[PLAYER_A].address // currentTurn
    );
    
    await gameLogic.connect(players[PLAYER_A]).processAction(players[PLAYER_A].address, CHECK, 0);
    await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);
    
    // Now on river
    await stateStorage.connect(owner).updateGameBasics(
      3, // BettingRound.River
      600, // mainPot
      0, // currentBet
      players[PLAYER_A].address // currentTurn
    );
    
    // Setup player hands for deterministic outcome
    // Give Player A the best hand
    await stateStorage.connect(owner).updatePlayerState(players[PLAYER_A].address, {
      stack: await stateStorage.getPlayer(players[PLAYER_A].address).then((p: { stack: bigint }) => p.stack),
      status: 1, // Active
      currentBet: 0,
      position: PLAYER_A,
      holeCards: [0, 12], // Ace high
      lastActionTime: 0,
      totalContribution: 200
    });
    
    // Give Player B a weaker hand
    await stateStorage.connect(owner).updatePlayerState(players[PLAYER_B].address, {
      stack: 0,
      status: 4, // AllIn
      currentBet: 200,
      position: PLAYER_B,
      holeCards: [8, 9], // Lower cards
      lastActionTime: 0,
      totalContribution: 200
    });
    
    // Give Player C a middle hand
    await stateStorage.connect(owner).updatePlayerState(players[PLAYER_C].address, {
      stack: await stateStorage.getPlayer(players[PLAYER_C].address).then((p: { stack: bigint }) => p.stack),
      status: 1, // Active
      currentBet: 0,
      position: PLAYER_C,
      holeCards: [10, 11], // Medium cards
      lastActionTime: 0,
      totalContribution: 200
    });
    
    // Set community cards for a deterministic outcome
    await stateStorage.connect(owner).updateGameCards([1, 2, 3, 4, 5]);
    
    // Final checks and showdown
    await gameLogic.connect(players[PLAYER_A]).processAction(players[PLAYER_A].address, CHECK, 0);
    await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);
    
    // Hand should now be complete with pot awarded
    // Check final stacks
    console.log("\n----- FINAL STACKS AFTER SHOWDOWN -----");
    const finalPlayerA = await stateStorage.getPlayer(players[PLAYER_A].address);
    const finalPlayerB = await stateStorage.getPlayer(players[PLAYER_B].address);
    const finalPlayerC = await stateStorage.getPlayer(players[PLAYER_C].address);
    
    console.log(`Player A final stack: ${finalPlayerA.stack}`);
    console.log(`Player B final stack: ${finalPlayerB.stack}`);
    console.log(`Player C final stack: ${finalPlayerC.stack}`);
    
    // Get initial stacks from stateStorage
    const initialStackA = await stateStorage.getPlayer(players[PLAYER_A].address).then((p: { stack: bigint }) => p.stack);

    // Player A should win the pot
    expect(finalPlayerA.stack).to.be.gt(initialStackA); // A's stack should have increased
    expect(finalPlayerB.stack).to.equal(0); // B should still have 0 (all-in and lost)
    
    // Game state should be reset
    const finalGameState = await stateStorage.getGameState();
    expect(finalGameState.mainPot).to.equal(0); // Pot should be empty after distribution
  });
});