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