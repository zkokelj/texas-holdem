import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Tests the basic side pot functionality with 3 players:
 * - Player A: Normal stack (1000)
 * - Player B: Small stack (200) - will go all-in
 * - Player C: Normal stack (1000)
 * Each player is dealt specific hole cards to create deterministic winning scenarios.
 */
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

  }

  /**
   * Tests a complex side pot scenario with 5 players:
   * - Player A: Small stack (100) with best hand (three 8s)
   * - Player B: Normal stack (1000) with second-best hand (pair of Jacks)
   * - Player C: Normal stack (1000) with worst hand (2-7 offsuit)
   * - Player D: Normal stack (1000) - folds
   * - Player E: Normal stack (1000) - folds
   * 
   * The test simulates a betting sequence where:
   * 1. Player A goes all-in with their small stack
   * 2. Players B and C continue betting in a side pot
   * 3. Players D and E fold
   * 4. Verifies that Player A wins the main pot and Player B wins the side pot
   */
  describe("GameLogic - All In side pot split test", function () {
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
  
    // Player positions for clarity
    const PLAYER_A = 0; // all-in with smallest stack but best hand (for main pot)
    const PLAYER_B = 1; // second-best hand (for side pot)
    const PLAYER_C = 2; // worst hand
    const PLAYER_D = 3; // fold
    const PLAYER_E = 4; // fold
  
    // Stack sizes
    const SMALL_STACK = 100;   // Player A (all-in player)
    const NORMAL_STACK = 1000; // Players B and C
    
    beforeEach(async function () {
      // Deploy contracts
      [owner, ...players] = await ethers.getSigners();
  
      const StateStorage = await ethers.getContractFactory("StateStorage");
      stateStorage = await (await StateStorage.connect(owner).deploy()).waitForDeployment();
  
      const HandManager = await ethers.getContractFactory("HandManager");
      handManager = await (await HandManager.connect(owner).deploy(await stateStorage.getAddress())).waitForDeployment();
  
      const HandEvaluator = await ethers.getContractFactory("HandEvaluator");
      handEvaluator = await (await HandEvaluator.connect(owner).deploy()).waitForDeployment();
  
      const GameLogic = await ethers.getContractFactory("GameLogic");
      gameLogic = await (await GameLogic.connect(owner).deploy(
        await stateStorage.getAddress(),
        await handManager.getAddress(),
        await handEvaluator.getAddress()
      )).waitForDeployment();
  
      // Set permissions
      await stateStorage.connect(owner).authorizeContract(await gameLogic.getAddress());
      await stateStorage.connect(owner).authorizeContract(await handManager.getAddress());
      await stateStorage.connect(owner).authorizeContract(owner.address);
  
      // Setup players
      await setupFivePlayerGame();
    });
  
    async function setupFivePlayerGame() {
        // Set up five players with specified stacks and hole cards
        for (let i = 0; i < 5; i++) {
          // Player A gets small stack, others get normal stack
          const stack = i === PLAYER_A ? SMALL_STACK : NORMAL_STACK;
          
          // Card assignments to create specific winning scenarios:
          let holeCards;
          
          if (i === PLAYER_A) {
            // Player A: Pocket 8s for three of a kind with community 8
            holeCards = [6, 19]; // 8♣, 8♦ (indices 6, 19)
          } else if (i === PLAYER_B) {
            // Player B: Pocket Jacks for a pair
            holeCards = [9, 22]; // J♣, J♦ (indices 9, 22)
          } else if (i === PLAYER_C) {
            // Player C: 2-7 offsuit (worst starting hand)
            holeCards = [0, 18]; // 2♣, 7♦ (indices 0, 18)
          } else if (i === PLAYER_D) {
            // Player D: Low cards (will fold)
            holeCards = [1, 14]; // 3♣, 3♦ (indices 1, 14)
          } else {
            // Player E: Low cards (will fold)
            holeCards = [2, 15]; // 4♣, 4♦ (indices 2, 15)
          }
          
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
      
        // Initialize game state at PreFlop
        await stateStorage.connect(owner).updateGameBasics(
          0, // PreFlop round (0)
          0, // Empty pot
          0, // No bet
          players[PLAYER_A].address // Player A starts
        );
      
        // Set community cards:
        // 8♠ (45) - gives Player A three of a kind (different suit from Player A's 8s)
        // K♠ (50) - high card
        // A♠ (51) - high card
        // 5♠ (42) - irrelevant
        // T♠ (47) - irrelevant
        await stateStorage.connect(owner).updateGameCards([45, 50, 51, 42, 47]);
      }
  
    it("should correctly handle pot distribution with multiple winners", async function () {
      // Initial stacks logging for debugging
      console.log("----- SIDE POT DISTRIBUTION TEST -----");
      
      // Player A (small stack) raises 50
      await gameLogic.connect(players[PLAYER_A]).processAction(players[PLAYER_A].address, RAISE, 50);
      
      // Player B calls 50
      await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CALL, 0);
      
      // Player C raises to 150 (100 more than the current bet)
      await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, RAISE, 100);
      
      // Player D folds
      await gameLogic.connect(players[PLAYER_D]).processAction(players[PLAYER_D].address, FOLD, 0);
      
      // Player E folds
      await gameLogic.connect(players[PLAYER_E]).processAction(players[PLAYER_E].address, FOLD, 0);
      
      // Player A (small stack) calls, but can only put in their remaining 50 chips (all-in)
      await gameLogic.connect(players[PLAYER_A]).processAction(players[PLAYER_A].address, CALL, 0);
      
      // Critical state check after all-in
      const playerAState = await stateStorage.getPlayer(players[PLAYER_A].address);
      console.log("Player A status after all-in:", playerAState.status);
      console.log("Player A stack after all-in:", playerAState.stack);
      
      // Player B calls 100 more
      await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CALL, 0);
      
      // Player B checks
      await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CHECK, 0);

      // Player C checks
      await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);

      // Player B checks
      await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CHECK, 0);

      // Player C checks
      await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);

      // Set community cards right before final round:
      // 8♠, Q♦, 6♣, 5♠, A♦
      await stateStorage.connect(owner).updateGameCards([45, 24, 37, 42, 10]);

      // Player B checks
      await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CHECK, 0);

      // Player C checks
      await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);
      
      // Get the final player states for verification
      const playerAFinal = await stateStorage.getPlayer(players[PLAYER_A].address);
      const playerBFinal = await stateStorage.getPlayer(players[PLAYER_B].address);
      const playerCFinal = await stateStorage.getPlayer(players[PLAYER_C].address);
      
      // Calculate expected outcomes - convert to BigInt
      const mainPotSize = BigInt(Number(playerAFinal.currentBet)) * BigInt(3);
      const sidePotSize = BigInt(Number(playerBFinal.currentBet - playerAFinal.currentBet)) * BigInt(2);
      
      // Verify the outcomes
      expect(playerAFinal.stack).to.be.greaterThan(BigInt(0), "Player A should have won something (the main pot)");
      expect(playerBFinal.stack).to.be.greaterThan(BigInt(NORMAL_STACK - 150), "Player B should have more than just their remaining chips");
      expect(playerCFinal.stack).to.be.lessThan(BigInt(NORMAL_STACK), "Player C should have lost their contribution");

      // Verify the total pot is empty at the end
      const finalGameState = await stateStorage.getGameState();
      expect(finalGameState.mainPot).to.equal(BigInt(0));
    });
  });
});

/**
 * Tests the double all-in scenario with proper pot distribution in Texas Hold'em rules.
 * 
 * Test scenario:
 * - Player A: 100 chips (tiny stack), Pocket Aces (best hand)
 * - Player B: 200 chips (small stack), Pocket Kings (second-best hand)
 * - Players C, D, E: 1000 chips each, low cards (all fold)
 * 
 * Betting sequence:
 * 1. Player A goes all-in with 100 chips
 * 2. Player B raises all-in to 200 chips
 * 3. Players C, D, and E fold
 * 
 * Expected pot distribution according to Texas Hold'em rules:
 * - Main pot: 200 chips (100 from A + 100 from B)
 * - Side pot: 100 chips (B's extra 100 that A couldn't match)
 * 
 * Final outcome:
 * - Player A wins main pot of 200 chips (wins what they could match)
 * - Player B keeps their unmatched 100 chips (the portion A couldn't call)
 * - Other players lose nothing (folded before committing chips)
 * 
 * This illustrates a key Texas Hold'em rule: players can only win from 
 * each opponent up to the amount they put at risk. When going all-in for 100,
 * you can't win more than 100 from each opponent, even if they bet more.
 */
describe("GameLogic - Double All-In Test", function () {
  // Contract instances and constants remain the same...
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

  // Player positions
  const PLAYER_A = 0; // Small stack (100), best hand
  const PLAYER_B = 1; // Medium stack (200), second-best hand
  const PLAYER_C = 2; // Normal stack (1000), will fold
  const PLAYER_D = 3; // Normal stack (1000), will fold
  const PLAYER_E = 4; // Normal stack (1000), will fold

  // Stack sizes
  const TINY_STACK = 100;    // Player A
  const SMALL_STACK = 200;   // Player B
  const NORMAL_STACK = 1000; // Other players

  beforeEach(async function () {
    // Deploy contracts
    [owner, ...players] = await ethers.getSigners();

    const StateStorage = await ethers.getContractFactory("StateStorage");
    stateStorage = await (await StateStorage.connect(owner).deploy()).waitForDeployment();

    const HandManager = await ethers.getContractFactory("HandManager");
    handManager = await (await HandManager.connect(owner).deploy(await stateStorage.getAddress())).waitForDeployment();

    const HandEvaluator = await ethers.getContractFactory("HandEvaluator");
    handEvaluator = await (await HandEvaluator.connect(owner).deploy()).waitForDeployment();

    const GameLogic = await ethers.getContractFactory("GameLogic");
    gameLogic = await (await GameLogic.connect(owner).deploy(
      await stateStorage.getAddress(),
      await handManager.getAddress(),
      await handEvaluator.getAddress()
    )).waitForDeployment();

    // Set permissions
    await stateStorage.connect(owner).authorizeContract(await gameLogic.getAddress());
    await stateStorage.connect(owner).authorizeContract(await handManager.getAddress());
    await stateStorage.connect(owner).authorizeContract(owner.address);

    await setupFivePlayerGame();
  });

  async function setupFivePlayerGame() {
    // Set up five players with specified stacks and hole cards
    for (let i = 0; i < 5; i++) {
      // Assign stacks based on position
      let stack;
      if (i === PLAYER_A) {
        stack = TINY_STACK;   // Player A gets tiny stack
      } else if (i === PLAYER_B) {
        stack = SMALL_STACK;  // Player B gets small stack
      } else {
        stack = NORMAL_STACK; // Others get normal stack
      }

      // Card assignments to create specific winning scenarios:
      let holeCards;
      if (i === PLAYER_A) {
        // Player A: Pocket Aces for best hand
        holeCards = [12, 25]; // A♣, A♦
      } else if (i === PLAYER_B) {
        // Player B: Pocket Kings for second-best hand
        holeCards = [11, 24]; // K♣, K♦
      } else {
        // Other players: Low cards (will fold)
        holeCards = [i * 2, i * 2 + 1];
      }

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

    // Initialize game state at PreFlop
    await stateStorage.connect(owner).updateGameBasics(
      0, // PreFlop round
      0, // Empty pot
      0, // No bet
      players[PLAYER_A].address // Player A starts
    );

    // Set community cards that won't interfere with pocket pairs
    await stateStorage.connect(owner).updateGameCards([45, 46, 47, 42, 43]);
    // 8♠, 9♠, T♠, 5♠, 6♠
  }

  it("should correctly handle double all-in with folds", async function () {
    console.log("----- DOUBLE ALL-IN WITH FOLDS TEST -----");

    // Log initial stacks
    console.log("\nInitial stacks:");
    for (let i = 0; i < 5; i++) {
      const player = await stateStorage.getPlayer(players[i].address);
      console.log(`Player ${i} stack: ${player.stack}`);
    }

    // Player A (tiny stack) goes all-in with 100
    console.log("\nPlayer A goes all-in with 100");
    await gameLogic.connect(players[PLAYER_A]).processAction(players[PLAYER_A].address, RAISE, 100);

    // Player B (small stack) raises all-in to 200
    console.log("\nPlayer B raises all-in to 200");
    await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, RAISE, 100);

    // Other players fold
    console.log("\nPlayers C, D, and E fold");
    await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, FOLD, 0);
    await gameLogic.connect(players[PLAYER_D]).processAction(players[PLAYER_D].address, FOLD, 0);
    await gameLogic.connect(players[PLAYER_E]).processAction(players[PLAYER_E].address, FOLD, 0);

    // Log final state
    const playerAFinal = await stateStorage.getPlayer(players[PLAYER_A].address);
    const playerBFinal = await stateStorage.getPlayer(players[PLAYER_B].address);

    console.log("\nFinal stacks:");
    console.log(`Player A final stack: ${playerAFinal.stack}`);
    console.log(`Player B final stack: ${playerBFinal.stack}`);

    // Correct pot distribution according to Texas Hold'em rules:
    // - Main pot: 200 (100 from each player)
    // - Side pot: 100 (B's extra 100 that A couldn't match)
    // Since Player A has better hand (Aces vs Kings):
    // - Player A wins main pot (200)
    // - Player B keeps their side pot (100)
    expect(playerAFinal.stack).to.be.equal(BigInt(200), "Player A should win the main pot (200)");
    expect(playerBFinal.stack).to.be.equal(BigInt(100), "Player B should keep their unmatched chips (100)");

    // Verify pots are empty
    const finalGameState = await stateStorage.getGameState();
    expect(finalGameState.mainPot).to.equal(BigInt(0), "Main pot should be empty after distribution");
  });

  it("should correctly handle double all-in with folds in flop round", async function () {
    console.log("----- DOUBLE ALL-IN IN FLOP ROUND TEST -----");

    // Log initial stacks
    console.log("\nInitial stacks:");
    for (let i = 0; i < 5; i++) {
        const player = await stateStorage.getPlayer(players[i].address);
        console.log(`Player ${i} stack: ${player.stack}`);
    }

    // Pre-flop round
    console.log("\n=== PRE-FLOP ROUND ===");
    
    // Player A makes a smaller bet to save chips for flop
    console.log("\nPlayer A raises to 50");
    await gameLogic.connect(players[PLAYER_A]).processAction(players[PLAYER_A].address, RAISE, 50);

    // All other players call
    console.log("\nAll players call 50");
    for (let i = 1; i < 5; i++) {
        await gameLogic.connect(players[i]).processAction(players[i].address, CALL, 0);
    }

    // Get the game state to see whose turn it is
    let gameState = await stateStorage.getGameState();
    console.log("\nCurrent turn before preflop completion:", gameState.currentTurn);

    // Move to flop round by checking, starting with the correct player
    console.log("\n=== MOVING TO FLOP ===");
    // We need to determine the first player to act and then follow in order
    // In most poker games, small blind acts first after preflop
    // Let's log each attempt to check to see where we are
    for (let i = 0; i < 5; i++) {
        try {
            gameState = await stateStorage.getGameState();
            console.log(`Attempting check from player ${i}, currentTurn is: ${gameState.currentTurn}`);
            if (gameState.currentTurn === players[i].address) {
                await gameLogic.connect(players[i]).processAction(players[i].address, CHECK, 0);
                console.log(`Player ${i} successfully checked`);
            }
        } catch (error) {
            console.log(`Error when player ${i} tried to check: ${error.message}`);
        }
    }

    gameState = await stateStorage.getGameState();
    console.log("Current round after preflop:", gameState.currentRound);
    console.log("Current turn after preflop:", gameState.currentTurn);

    // Flop round - Player A should have 50 chips left
    console.log("\n=== FLOP ROUND ===");

    // Player A (tiny stack) goes all-in with remaining 50
    console.log("\nPlayer A goes all-in with remaining 50");
    await gameLogic.connect(players[PLAYER_A]).processAction(players[PLAYER_A].address, RAISE, 50);

    // Player B (small stack) raises all-in
    console.log("\nPlayer B raises all-in");
    await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, RAISE, 150);

    // Other players fold
    console.log("\nPlayers C, D, and E fold");
    await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, FOLD, 0);
    await gameLogic.connect(players[PLAYER_D]).processAction(players[PLAYER_D].address, FOLD, 0);
    await gameLogic.connect(players[PLAYER_E]).processAction(players[PLAYER_E].address, FOLD, 0);

    // Log final state
    const playerAFinal = await stateStorage.getPlayer(players[PLAYER_A].address);
    const playerBFinal = await stateStorage.getPlayer(players[PLAYER_B].address);

    console.log("\nFinal stacks:");
    console.log(`Player A final stack: ${playerAFinal.stack}`);
    console.log(`Player B final stack: ${playerBFinal.stack}`);

    // Total contributions:
    // Player A: 50 (preflop) + 50 (flop) = 100 total
    // Player B: 50 (preflop) + 150 (flop) = 200 total
    // Other players: 50 each (preflop only)
    
    // Main pot should be: 100 x 2 + 50 x 3 = 350
    // Side pot should be: 100 (B's extra that A couldn't match)
    
    // Since Player A has better hand (Aces vs Kings):
    // - Player A wins main pot (350)
    // - Player B keeps their side pot (100)
    expect(playerAFinal.stack).to.be.equal(BigInt(350), "Player A should win the main pot (350)");
    expect(playerBFinal.stack).to.be.equal(BigInt(100), "Player B should keep their unmatched chips (100)");

    // Verify pots are empty
    const finalGameState = await stateStorage.getGameState();
    expect(finalGameState.mainPot).to.equal(BigInt(0), "Main pot should be empty after distribution");
  });


});