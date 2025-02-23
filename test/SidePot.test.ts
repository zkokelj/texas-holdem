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

  }

  describe("GameLogic - Complex Side Pot Test", function () {
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
      console.log("----- SIDE POT DISTRIBUTION TEST -----");
      
      // Log initial stacks
      console.log("Initial stacks:");
      for (let i = 0; i < 5; i++) {
        const player = await stateStorage.getPlayer(players[i].address);
        console.log(`Player ${i} stack: ${player.stack}`);
      }
  
      // Log initial game state
      const initialGameState = await stateStorage.getGameState();
      console.log("\nInitial game state:");
      console.log("Current turn:", initialGameState.currentTurn);
      console.log("Current round:", initialGameState.currentRound);
  
      // Player A (small stack) raises 50
      console.log("\nPlayer A raises 50");
      await gameLogic.connect(players[PLAYER_A]).processAction(players[PLAYER_A].address, RAISE, 50);
      
      // Player B calls 50
      console.log("\nPlayer B calls 50");
      await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CALL, 0);
      
      // Player C raises to 150 (100 more than the current bet)
      console.log("\nPlayer C raises 100 more (to 150 total)");
      await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, RAISE, 100);
      
      // Player D folds
      console.log("\nPlayer D folds");
      await gameLogic.connect(players[PLAYER_D]).processAction(players[PLAYER_D].address, FOLD, 0);
      
      // Player E folds
      console.log("\nPlayer E folds");
      await gameLogic.connect(players[PLAYER_E]).processAction(players[PLAYER_E].address, FOLD, 0);
      
      // Player A (small stack) calls, but can only put in their remaining 50 chips (all-in)
      console.log("\nPlayer A calls but goes all-in");
      await gameLogic.connect(players[PLAYER_A]).processAction(players[PLAYER_A].address, CALL, 0);
      
      // Check Player A's status - should be all-in
      const playerAState = await stateStorage.getPlayer(players[PLAYER_A].address);
      console.log("Player A status after going all-in:", playerAState.status);
      console.log("Player A stack after going all-in:", playerAState.stack);
      console.log("Player A currentBet:", playerAState.currentBet);
      console.log("Player A totalContribution:", playerAState.totalContribution);
      
      // Player B calls 100 more
      console.log("\nPlayer B calls to 150");
      await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CALL, 0);
      
      // Log stack status after betting
      console.log("\nStacks after betting:");
      const gameStateAfterBetting = await stateStorage.getGameState();
      console.log(`Main pot: ${gameStateAfterBetting.mainPot}`);
      console.log(`Current round: ${gameStateAfterBetting.currentRound}`);
      console.log(`Current bet: ${gameStateAfterBetting.currentBet}`);
      console.log(`Current turn: ${gameStateAfterBetting.currentTurn}`);
      
      for (let i = 0; i < 5; i++) {
        const player = await stateStorage.getPlayer(players[i].address);
        console.log(`Player ${i} stack: ${player.stack}, status: ${player.status}, currentBet: ${player.currentBet}, contribution: ${player.totalContribution}`);
      }

      const gameStateAfterBetting2 = await stateStorage.getGameState();
      console.log("Current round after betting2:", gameStateAfterBetting2.currentRound);

      // Player B checks
      console.log("\nPlayer B checks");
      await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CHECK, 0);

      // Player C checks
      console.log("\nPlayer C checks");
      await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);

      const gameStateAfterBetting3 = await stateStorage.getGameState();
      console.log("Current round after betting3:", gameStateAfterBetting3.currentRound);

      // Player B checks
      console.log("\nPlayer B checks");
      await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CHECK, 0);

      // Player C checks
      console.log("\nPlayer C checks");
      await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);

      const gameStateAfterBetting4 = await stateStorage.getGameState();
      console.log("Current round after betting4:", gameStateAfterBetting4.currentRound);

      // Set community cards right before final round:
      // 8♠, Q♦, 6♣, 5♠, A♦
      await stateStorage.connect(owner).updateGameCards([45, 24, 37, 42, 10]);

      // Player B checks
      console.log("\nPlayer B checks");
      await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CHECK, 0);

      // Player C checks
      console.log("\nPlayer C checks");
      await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);

      const gameStateAfterBetting5 = await stateStorage.getGameState();
      console.log("Current round after betting5:", gameStateAfterBetting5.currentRound);
  
      // Log final stacks
      console.log("\nFinal stacks after showdown:");
      for (let i = 0; i < 5; i++) {
        const player = await stateStorage.getPlayer(players[i].address);
        console.log(`Player ${i} stack: ${player.stack}`);
      }
      
      // Get the final player states
      const playerAFinal = await stateStorage.getPlayer(players[PLAYER_A].address);
      const playerBFinal = await stateStorage.getPlayer(players[PLAYER_B].address);
      const playerCFinal = await stateStorage.getPlayer(players[PLAYER_C].address);
      
      console.log("\nDetailed final states:");
      console.log(`Player A: stack=${playerAFinal.stack}, contribution=${playerAFinal.totalContribution}`);
      console.log(`Player B: stack=${playerBFinal.stack}, contribution=${playerBFinal.totalContribution}`);
      console.log(`Player C: stack=${playerCFinal.stack}, contribution=${playerCFinal.totalContribution}`);
      
      // Calculate total pot
      const totalPot = playerAFinal.totalContribution + playerBFinal.totalContribution + playerCFinal.totalContribution;
      console.log(`Total pot based on contributions: ${totalPot}`);
      
      // Calculate expected outcomes - convert to BigInt
      const mainPotSize = BigInt(Number(playerAFinal.currentBet)) * BigInt(3); // 3 players contributing up to Player A's all-in amount
      const sidePotSize = BigInt(Number(playerBFinal.currentBet - playerAFinal.currentBet)) * BigInt(2); // Extra amount beyond all-in from 2 players
      
      console.log(`Expected main pot: ${mainPotSize}`);
      console.log(`Expected side pot: ${sidePotSize}`);
      
      // Expected outcomes:
      // 1. Player A should win the main pot (3 players × A's all-in amount)
      // 2. Player B should win the side pot (2 players × additional amount beyond A's all-in)
      // 3. Player C should lose their contribution
      
      // Basic assertions - should be true in any correct implementation
      expect(playerAFinal.stack).to.be.greaterThan(BigInt(0), "Player A should have won something (the main pot)");
      expect(playerBFinal.stack).to.be.greaterThan(BigInt(NORMAL_STACK - 150), "Player B should have more than just their remaining chips");
      expect(playerCFinal.stack).to.be.lessThan(BigInt(NORMAL_STACK), "Player C should have lost their contribution");

      // Also verify the total pot is empty
      const finalGameState = await stateStorage.getGameState();
      expect(finalGameState.mainPot).to.equal(BigInt(0));
    });
  });
});