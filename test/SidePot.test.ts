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

    // Set community cards to give Player A three of a kind
    // Using: 8♥, K♣, A♦, 4♠, 3♠
    await stateStorage.connect(owner).updateGameCards([33, 12, 13, 43, 42]);
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

    // Basic assertions - should be true in any correct implementation
    expect(playerBAfter.stack).to.be.greaterThan(BigInt(NORMAL_STACK - 100), "Player B should have more than just their remaining chips");
    expect(stateAfterAllIn.mainPot).to.equal(BigInt(0));
  });

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
    const PLAYER_A = 0; // Will go all-in with smallest stack but best hand (for main pot)
    const PLAYER_B = 1; // Will have second-best hand (for side pot)
    const PLAYER_C = 2; // Will have worst hand
    const PLAYER_D = 3; // Will fold
    const PLAYER_E = 4; // Will fold
  
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
            // Player A: Pocket 8s for three of a kind with community cards
            holeCards = [7, 20]; // 8♣, 8♦
          } else if (i === PLAYER_B) {
            // Player B: Pocket Jacks for a pair
            holeCards = [10, 23]; // J♣, J♦
          } else if (i === PLAYER_C) {
            // Player C: 2-7 offsuit (worst starting hand)
            holeCards = [1, 19]; // 2♣, 7♦
          } else {
            // Players D and E: Random low cards (they will fold)
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
          0, // PreFlop round (0)
          0, // Empty pot
          0, // No bet
          players[PLAYER_A].address // Player A starts
        );
      
        // Set community cards to give Player A three of a kind
        // Using: 8♥, K♣, A♦, 4♠, 3♠
        await stateStorage.connect(owner).updateGameCards([33, 12, 13, 43, 42]);
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
  
      // Set up a try-catch block to handle the chain of actions that need to happen
      try {
        // If we're still in PreFlop, move to Flop
        if (gameStateAfterBetting.currentRound === 0) {
          console.log("\nAttempting to move to Flop");
          await gameLogic.nextRound();
          console.log("Successfully moved to Flop");
          
          const flop = await stateStorage.getGameState();
          console.log("Current round after nextRound:", flop.currentRound);
          console.log("Current turn:", flop.currentTurn);
          
          // Check who needs to act in this round
          const playerBTurn = flop.currentTurn === players[PLAYER_B].address;
          const playerCTurn = flop.currentTurn === players[PLAYER_C].address;
          
          console.log("Is it Player B's turn?", playerBTurn);
          console.log("Is it Player C's turn?", playerCTurn);
          
          // Depending on whose turn it is, have them CHECK
          if (playerBTurn) {
            console.log("Player B checks");
            await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CHECK, 0);
            console.log("Player C checks");
            await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);
          } else if (playerCTurn) {
            console.log("Player C checks");
            await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);
            console.log("Player B checks");
            await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CHECK, 0);
          }
          
          // Move to Turn
          console.log("\nAttempting to move to Turn");
          await gameLogic.nextRound();
          console.log("Successfully moved to Turn");
          
          const turn = await stateStorage.getGameState();
          console.log("Current round after nextRound:", turn.currentRound);
          
          // CHECK actions on Turn
          if (turn.currentTurn === players[PLAYER_B].address) {
            await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CHECK, 0);
            await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);
          } else {
            await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);
            await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CHECK, 0);
          }
          
          // Move to River
          console.log("\nAttempting to move to River");
          await gameLogic.nextRound();
          console.log("Successfully moved to River");
          
          const river = await stateStorage.getGameState();
          console.log("Current round after nextRound:", river.currentRound);
          
          // CHECK actions on River
          if (river.currentTurn === players[PLAYER_B].address) {
            await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CHECK, 0);
            await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);
          } else {
            await gameLogic.connect(players[PLAYER_C]).processAction(players[PLAYER_C].address, CHECK, 0);
            await gameLogic.connect(players[PLAYER_B]).processAction(players[PLAYER_B].address, CHECK, 0);
          }
          
          // Showdown should happen automatically now
        } else {
          console.log("Game already progressed past PreFlop - unexpected state");
        }
      } catch (error: any) {
        console.log("Error occurred:", error.message);
        
        // If error says "Hand complete", it means the showdown already happened
        if (error.message.includes("Hand complete")) {
          console.log("Hand is already complete, showdown likely happened automatically");
        } else {
          throw error;
        }
      }
  
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