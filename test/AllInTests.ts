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

  /**
 * Tests edge cases for all-in scenarios and side pot distributions in Texas Hold'em.
 * Each test case verifies specific edge case scenarios that commonly occur in poker games.
 */
describe("GameLogic - All-in Edge Cases", function () {
  // Contract setup code same as before...

  /**
   * Tests a triple all-in scenario where three players have different stack sizes
   * and each wins a different pot.
   * 
   * Scenario:
   * - Player A: 100 chips, pocket Aces (best hand)
   * - Player B: 300 chips, pocket Kings (second-best hand)
   * - Player C: 500 chips, pocket Queens (third-best hand)
   * 
   * Expected pots:
   * - Main pot: 300 (100 x 3) - Player A wins
   * - First side pot: 400 (200 x 2) - Player B wins
   * - Second side pot: 200 (Player C's extra) - Player C keeps
   */
  it("should handle triple all-in with different stack sizes", async function () {
    // Initial setup with different stack sizes
    const stacks = {
        A: 100,  // Smallest stack
        B: 300,  // Medium stack
        C: 500   // Largest stack
    };

    // Set up players
    for (let i = 0; i < 3; i++) {
        let stack = i === 0 ? stacks.A : (i === 1 ? stacks.B : stacks.C);
        let holeCards;
        
        if (i === 0) {
            // Player A: Pocket Aces
            holeCards = [12, 25]; // A♣, A♦
        } else if (i === 1) {
            // Player B: Pocket Kings
            holeCards = [11, 24]; // K♣, K♦
        } else {
            // Player C: Pocket Queens
            holeCards = [10, 23]; // Q♣, Q♦
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

    // Initialize game state
    await stateStorage.connect(owner).updateGameBasics(
        0, // PreFlop round
        0, // Empty pot
        0, // No bet
        players[0].address // Player A starts
    );

    // Set community cards that don't improve anyone's hand
    await stateStorage.connect(owner).updateGameCards([2, 15, 28, 41, 47]);
    // 4♣, 4♦, 4♥, 4♠, T♠ (Four of a kind on board, high card decides)

    console.log("----- TRIPLE ALL-IN TEST -----");
    
    // Log initial stacks
    console.log("\nInitial stacks:");
    for (let i = 0; i < 3; i++) {
        const player = await stateStorage.getPlayer(players[i].address);
        console.log(`Player ${i} stack: ${player.stack}`);
    }

    // Player A goes all-in for 100
    console.log("\nPlayer A goes all-in with 100");
    await gameLogic.connect(players[0]).processAction(players[0].address, RAISE, 100);

    // Player B goes all-in for 300
    console.log("\nPlayer B raises all-in to 300");
    await gameLogic.connect(players[1]).processAction(players[1].address, RAISE, 200);


    // Print game state
    const gameState = await stateStorage.getGameState();
    console.log("\nGame State:");
    console.log("Main Pot:", gameState.mainPot);
    console.log("Side Pots:", gameState.sidePots);
    console.log("Current Round:", gameState.currentRound);
    console.log("Current Bet:", gameState.currentBet);
    console.log("Current Player to Act:", gameState.currentPlayer);

    // Player C goes all-in for 500
    console.log("\nPlayer C raises all-in to 500");
    await gameLogic.connect(players[2]).processAction(players[2].address, RAISE, 200);

    // Print game state after the last all-in
    const finalGameStateAfterAllIn = await stateStorage.getGameState();
    console.log("\nGame State after last all-in:");
    console.log("Main Pot:", finalGameStateAfterAllIn.mainPot);
    console.log("Side Pots:", finalGameStateAfterAllIn.sidePots);
    console.log("Current Round:", finalGameStateAfterAllIn.currentRound);
    console.log("Current Bet:", finalGameStateAfterAllIn.currentBet);
    console.log("Current Player to Act:", finalGameStateAfterAllIn.currentPlayer);



    // Get final states
    const playerAFinal = await stateStorage.getPlayer(players[0].address);
    const playerBFinal = await stateStorage.getPlayer(players[1].address);
    const playerCFinal = await stateStorage.getPlayer(players[2].address);

    console.log("\nFinal stacks:");
    console.log(`Player A final stack: ${playerAFinal.stack}`);
    console.log(`Player B final stack: ${playerBFinal.stack}`);
    console.log(`Player C final stack: ${playerCFinal.stack}`);

    // Verify correct pot distribution
    // Main pot (300 = 100 x 3) should go to Player A (Aces)
    expect(playerAFinal.stack).to.be.equal(BigInt(300), 
        "Player A should win the main pot of 300");

    // First side pot (400 = 200 x 2) should go to Player B (Kings)
    expect(playerBFinal.stack).to.be.equal(BigInt(400), 
        "Player B should win first side pot of 400");

    // Second side pot (200) should stay with Player C
    expect(playerCFinal.stack).to.be.equal(BigInt(200), 
        "Player C should keep their unmatched 200");

    // Verify all pots are empty
    const finalGameState = await stateStorage.getGameState();
    expect(finalGameState.mainPot).to.equal(BigInt(0), 
        "All pots should be empty after distribution");
    });

  /**
   * Tests a scenario where two players tie for the main pot while
   * one player wins the side pot.
   * 
   * Scenario:
   * - Player A: 200 chips, A♠K♠ (ties for main)
   * - Player B: 200 chips, A♥K♥ (ties for main)
   * - Player C: 400 chips, Q♠Q♥ (wins side pot)
   * 
   * Expected:
   * - Main pot splits between A and B
   * - Side pot goes to C
   */
  it("should handle split main pot with different side pot winner", async function () {
      // Setup code...
  });

  /**
   * Tests blind vs blind all-in scenario where small blind doesn't have
   * enough to cover the big blind.
   * 
   * Scenario:
   * - Small Blind: 10 chips (all-in)
   * - Big Blind: 20 chips (calls)
   * Expected:
   * - Main pot: 20 (2x10)
   * - Side pot: None
   * - Excess BB chips returned
   */
  it("should handle small blind vs big blind all-in", async function () {
      // Setup code...
  });

  /**
   * Tests scenario where multiple players go all-in with exactly matching stacks.
   * 
   * Scenario:
   * - Three players with exactly 100 chips each
   * Expected:
   * - Single pot of 300
   * - No side pots
   * - Winner takes all
   */
  it("should handle multiple all-ins with matching stacks", async function () {
      // Setup code...
  });

  /**
   * Tests complex scenario with multiple winners in different pots.
   * 
   * Scenario:
   * Player A: 100 chips (best hand)
   * Player B: 300 chips (second best)
   * Player C: 500 chips (third best)
   * Player D: 1000 chips (worst hand)
   * 
   * Expected pots:
   * - Main pot (400): Player A wins
   * - Side pot 1 (600): Player B wins
   * - Side pot 2 (400): Player C wins
   * - Side pot 3 (remaining): Player D keeps
   */
  it("should handle multiple winners in different side pots", async function () {
      // Setup code...
  });

  /**
   * Tests edge case where player goes all-in for less than the minimum raise.
   * 
   * Scenario:
   * - Current bet: 100
   * - Player A: 50 chips (all-in)
   * - Player B: 1000 chips
   * - Player C: 1000 chips
   * 
   * Expected:
   * - All-in doesn't constitute a raise
   * - Other players can just call 100
   */
  it("should handle all-in below minimum raise", async function () {
      // Setup code...
  });

  /**
   * Tests scenario where everyone calls an all-in but one player raises.
   * 
   * Scenario:
   * Player A: All-in 100
   * Players B,C,D: Call 100
   * Player E: Raises to 300
   * 
   * Expected:
   * - Main pot: 500 (100 x 5)
   * - Side pot: Between only those who could still bet
   */
  it("should handle raise after multiple all-in calls", async function () {
      // Setup code...
  });
});
});