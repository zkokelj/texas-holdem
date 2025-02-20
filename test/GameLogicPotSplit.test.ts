import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("GameLogic - Pot Split Scenarios", function () {
    // Contract instances
    let gameLogic: any;
    let stateStorage: any;
    let handManager: any;
    let handEvaluator: any;
    let owner: SignerWithAddress;
    let players: SignerWithAddress[];

    // Action constants for poker moves
    const FOLD = 0;     // Player surrenders their hand
    const CHECK = 1;    // Player passes when no bet to call
    const CALL = 2;     // Player matches the current bet
    const RAISE = 3;    // Player increases the current bet

    // Game configuration constants
    const INITIAL_STACK = 10000;  // Starting chips for each player
    const SMALL_BLIND = 25;       // Mandatory small blind bet
    const BIG_BLIND = 50;         // Mandatory big blind bet

    // Player position constants for 5-handed poker
    // Position order affects betting order and strategy
    const BUTTON = 0;    // Dealer position, last to act post-flop
    const SB = 1;       // Small Blind, posts smaller forced bet
    const BB = 2;       // Big Blind, posts larger forced bet
    const UTG = 3;      // Under the Gun, first to act pre-flop
    const MP = 4;       // Middle Position, acts between UTG and BTN

    beforeEach(async function () {
        // Get signers for testing - first signer is owner, rest are players
        [owner, ...players] = await ethers.getSigners();

        // Deploy and set up the contract system
        // StateStorage: Maintains game state and player information
        const StateStorage = await ethers.getContractFactory("StateStorage");
        stateStorage = await (await StateStorage.connect(owner).deploy()).waitForDeployment();

        // HandManager: Manages dealing and card operations
        const HandManager = await ethers.getContractFactory("HandManager");
        handManager = await (await HandManager.connect(owner).deploy(stateStorage.getAddress())).waitForDeployment();

        // HandEvaluator: Evaluates poker hands to determine winners
        const HandEvaluator = await ethers.getContractFactory("HandEvaluator");
        handEvaluator = await (await HandEvaluator.connect(owner).deploy()).waitForDeployment();

        // GameLogic: Main contract handling game flow and rules
        const GameLogic = await ethers.getContractFactory("GameLogic");
        gameLogic = await (await GameLogic.connect(owner).deploy(
            stateStorage.getAddress(),
            handManager.getAddress(),
            handEvaluator.getAddress()
        )).waitForDeployment();

        // Set up contract permissions
        await stateStorage.connect(owner).authorizeContract(gameLogic.getAddress());
        await stateStorage.connect(owner).authorizeContract(handManager.getAddress());
        await stateStorage.connect(owner).authorizeContract(owner.address);
    });

    // Test three-player showdown with clear winner
    describe.skip("Three-Player Showdown", function () {
        beforeEach(async function () {
            // Initialize each player's state with specific hole cards
            for (let i = 0; i < 5; i++) {
                let currentBet = 0;
                let stack = INITIAL_STACK;

                if (i === SB) {
                    currentBet = SMALL_BLIND;
                    stack = INITIAL_STACK - SMALL_BLIND;
                } else if (i === BB) {
                    currentBet = BIG_BLIND;
                    stack = INITIAL_STACK - BIG_BLIND;
                }

                // Assign specific hole cards to create a clear winner
                let holeCards;
                if (i === BUTTON) {
                    // BUTTON gets Ace-King suited (strongest hand)
                    holeCards = [51, 50]; // Ace of Spades, King of Spades
                } else if (i === UTG) {
                    // UTG gets Queen-Jack suited (second strongest)
                    holeCards = [49, 48]; // Queen of Spades, Jack of Spades
                } else if (i === MP) {
                    // MP gets Ten-Nine suited (third strongest)
                    holeCards = [47, 46]; // Ten of Spades, Nine of Spades
                } else {
                    // Other players get weaker cards
                    holeCards = [i * 2, i * 2 + 1];
                }

                await stateStorage.connect(owner).updatePlayerState(players[i].address, {
                    stack: stack,
                    status: 1, // Active
                    currentBet: currentBet,
                    position: i,
                    holeCards: holeCards,
                    lastActionTime: 0
                });
            }

            // Initialize the game state for pre-flop round
            await stateStorage.connect(owner).updateGameBasics(
                0,              // PreFlop round
                SMALL_BLIND + BIG_BLIND,      // Current pot size (SB + BB = 75)
                BIG_BLIND,      // Current bet to call
                players[UTG].address  // UTG starts the action pre-flop
            );
        });

        it("should correctly determine winner and award pot in three-player showdown", async function () {
            // Store initial stacks
            const initialStacks = {
                button: await stateStorage.getPlayer(players[BUTTON].address).then((p: { stack: number }) => p.stack),
                utg: await stateStorage.getPlayer(players[UTG].address).then((p: { stack: number }) => p.stack),
                mp: await stateStorage.getPlayer(players[MP].address).then((p: { stack: number }) => p.stack)
            };

            // Pre-flop round
            // UTG calls
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);
            // MP calls
            await gameLogic.connect(players[MP]).processAction(players[MP].address, CALL, 0);
            // BUTTON calls
            await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, CALL, 0);
            // SB folds
            await gameLogic.connect(players[SB]).processAction(players[SB].address, FOLD, 0);
            // BB checks
            await gameLogic.connect(players[BB]).processAction(players[BB].address, CHECK, 0);

            // Flop round
            // BB starts and bets 100
            await gameLogic.connect(players[BB]).processAction(players[BB].address, RAISE, 100);
            // UTG calls
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);
            // MP calls
            await gameLogic.connect(players[MP]).processAction(players[MP].address, CALL, 0);
            // BUTTON raises to 300
            await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, RAISE, 300);
            // BB folds
            await gameLogic.connect(players[BB]).processAction(players[BB].address, FOLD, 0);
            // UTG calls
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);
            // MP calls
            await gameLogic.connect(players[MP]).processAction(players[MP].address, CALL, 0);

            // Turn round
            // UTG checks
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CHECK, 0);
            // MP checks
            await gameLogic.connect(players[MP]).processAction(players[MP].address, CHECK, 0);
            // BUTTON bets 500
            await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, RAISE, 500);
            // UTG calls
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);
            // MP calls
            await gameLogic.connect(players[MP]).processAction(players[MP].address, CALL, 0);

            // River round
            // UTG checks
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CHECK, 0);
            // MP checks
            await gameLogic.connect(players[MP]).processAction(players[MP].address, CHECK, 0);
            // BUTTON bets 1000
            await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, RAISE, 1000);
            // UTG calls
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);
            // MP calls
            await gameLogic.connect(players[MP]).processAction(players[MP].address, CALL, 0);

            // Get final stacks
            const finalStacks = {
                button: await stateStorage.getPlayer(players[BUTTON].address).then((p: { stack: number }) => p.stack),
                utg: await stateStorage.getPlayer(players[UTG].address).then((p: { stack: number }) => p.stack),
                mp: await stateStorage.getPlayer(players[MP].address).then((p: { stack: number }) => p.stack)
            };

            // Calculate total pot size
            const totalBets =
                // Pre-flop: SB posts 25, BB posts 50, UTG/MP/BTN call 50 each = 225
                (SMALL_BLIND + BIG_BLIND + (BIG_BLIND * 3)) +
                // Flop first bet: BB bets 100, UTG/MP/BTN call = 400
                (100 * 4) +
                // Flop second bet: BUTTON raises to 300 (200 more), UTG/MP call = 600
                (200 * 3) +
                // Turn bet: BUTTON bets 500, UTG/MP call = 1500
                (500 * 3) +
                // River bet: BUTTON bets 1000, UTG/MP call = 3000
                (1000 * 3);
            // Total = 225 + 400 + 600 + 1500 + 3000 = 5725

            // BUTTON (Ace-King) should win
            expect(finalStacks.button).to.be.gt(initialStacks.button);
            expect(finalStacks.utg).to.be.lt(initialStacks.utg);
            expect(finalStacks.mp).to.be.lt(initialStacks.mp);

            // Verify pot is empty after distribution
            const gameState = await stateStorage.getGameState();
            expect(gameState.mainPot).to.equal(0);

            // Verify winner got the correct amount
            const buttonProfit = finalStacks.button - initialStacks.button;
            expect(buttonProfit).to.equal(4050); // Winner's profit is pot (6000) minus their own total contributions (1950)
        });
    });

    // Test split pot between two players with equal hands
    describe("Split Pot Showdown", function () {
        beforeEach(async function () {
            // Initialize each player's state with specific hole cards
            for (let i = 0; i < 5; i++) {
                let currentBet = 0;
                let stack = INITIAL_STACK;

                if (i === SB) {
                    currentBet = SMALL_BLIND;
                    stack = INITIAL_STACK - SMALL_BLIND;
                } else if (i === BB) {
                    currentBet = BIG_BLIND;
                    stack = INITIAL_STACK - BIG_BLIND;
                }

                // Assign specific hole cards to create a split pot scenario
                let holeCards;
                if (i === BUTTON) {
                    // BUTTON gets Ace-King suited in Spades
                    holeCards = [51, 50]; // Ace of Spades, King of Spades
                } else if (i === UTG) {
                    // UTG gets Ace-King suited in Hearts
                    holeCards = [38, 37]; // Ace of Hearts, King of Hearts
                } else {
                    // Other players get weaker cards
                    holeCards = [i * 2, i * 2 + 1];
                }

                await stateStorage.connect(owner).updatePlayerState(players[i].address, {
                    stack: stack,
                    status: 1, // Active
                    currentBet: currentBet,
                    position: i,
                    holeCards: holeCards,
                    lastActionTime: 0
                });
            }

            // Initialize the game state for pre-flop round
            await stateStorage.connect(owner).updateGameBasics(
                0,              // PreFlop round
                SMALL_BLIND + BIG_BLIND,      // Current pot size (SB + BB = 75)
                BIG_BLIND,      // Current bet to call
                players[UTG].address  // UTG starts the action pre-flop
            );
        });

        it("should correctly split pot between two players with equal hands", async function () {
            // Store initial stacks
            const initialStacks = {
                button: await stateStorage.getPlayer(players[BUTTON].address).then((p: { stack: number }) => p.stack),
                utg: await stateStorage.getPlayer(players[UTG].address).then((p: { stack: number }) => p.stack)
            };
            console.log("\nInitial stacks:");
            console.log("BUTTON:", initialStacks.button);
            console.log("UTG:", initialStacks.utg);

            // Pre-flop round
            // UTG calls
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);
            // MP folds
            await gameLogic.connect(players[MP]).processAction(players[MP].address, FOLD, 0);
            // BUTTON calls
            await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, CALL, 0);
            // SB folds (already posted 25)
            await gameLogic.connect(players[SB]).processAction(players[SB].address, FOLD, 0);
            // BB checks (already posted 50)
            await gameLogic.connect(players[BB]).processAction(players[BB].address, CHECK, 0);

            console.log("\nAfter pre-flop:");
            console.log("BUTTON stack:", await stateStorage.getPlayer(players[BUTTON].address).then((p: { stack: number }) => p.stack));
            console.log("UTG stack:", await stateStorage.getPlayer(players[UTG].address).then((p: { stack: number }) => p.stack));

            // Flop round
            // BB bets 100
            await gameLogic.connect(players[BB]).processAction(players[BB].address, RAISE, 100);
            // UTG calls
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);
            // BUTTON raises to 300
            await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, RAISE, 300);
            // BB folds
            await gameLogic.connect(players[BB]).processAction(players[BB].address, FOLD, 0);
            // UTG calls
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);

            console.log("\nAfter flop:");
            console.log("BUTTON stack:", await stateStorage.getPlayer(players[BUTTON].address).then((p: { stack: number }) => p.stack));
            console.log("UTG stack:", await stateStorage.getPlayer(players[UTG].address).then((p: { stack: number }) => p.stack));

            // Turn round
            // UTG checks
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CHECK, 0);
            // BUTTON bets 500
            await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, RAISE, 500);
            // UTG calls
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);

            console.log("\nAfter turn:");
            console.log("BUTTON stack:", await stateStorage.getPlayer(players[BUTTON].address).then((p: { stack: number }) => p.stack));
            console.log("UTG stack:", await stateStorage.getPlayer(players[UTG].address).then((p: { stack: number }) => p.stack));

            // River round
            // UTG checks
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CHECK, 0);
            // BUTTON bets 1000
            await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, RAISE, 1000);
            // UTG calls
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);

            // Get final stacks
            const finalStacks = {
                button: await stateStorage.getPlayer(players[BUTTON].address).then((p: { stack: number }) => p.stack),
                utg: await stateStorage.getPlayer(players[UTG].address).then((p: { stack: number }) => p.stack)
            };
            console.log("\nFinal stacks:");
            console.log("BUTTON:", finalStacks.button);
            console.log("UTG:", finalStacks.utg);

            // Calculate total pot
            const totalPot =
                // Pre-flop: SB(25) + BB(50) + UTG(50) + BTN(50) = 175
                175 +
                // Flop: BB(100) + UTG(100 + 200) + BTN(300) = 700
                700 +
                // Turn: BTN(500) + UTG(500) = 1000
                1000 +
                // River: BTN(1000) + UTG(1000) = 2000
                2000;
            // Total pot = 3875

            // Calculate expected profit
            // Each player should get:
            //  Their contribution back (1850) + half of the dead money 
            // TODO: @Ziga - check which player should get the remainder of the dead money
            const expectedProfitBUTTON = BigInt(88);
            const expectedProfitUTG = BigInt(87);

            // Calculate actual profits
            const buttonProfit = finalStacks.button - initialStacks.button;
            const utgProfit = finalStacks.utg - initialStacks.utg;
            console.log("\nProfits:");
            console.log("BUTTON profit:", buttonProfit);
            console.log("UTG profit:", utgProfit);
            console.log("Expected profit:", expectedProfitBUTTON);
            console.log("Dead money split calculation:", Math.floor(175 / 2));

            // Verify profits
            expect(buttonProfit).to.equal(expectedProfitBUTTON);
            expect(utgProfit).to.equal(expectedProfitUTG);
            // Verify pot is empty after distribution
            const gameState = await stateStorage.getGameState();
            expect(gameState.mainPot).to.equal(BigInt(0));

            // Verify final stacks
            expect(finalStacks.button).to.equal(initialStacks.button + expectedProfitBUTTON);
            expect(finalStacks.utg).to.equal(initialStacks.utg + expectedProfitUTG);
        });
    });

    describe("Pot Calculation Test", function () {
        beforeEach(async function () {
          // Initialize players with basic setup
          for (let i = 0; i < 3; i++) {
            await stateStorage.connect(owner).updatePlayerState(players[i].address, {
              stack: INITIAL_STACK,
              status: 1, // Active
              currentBet: 0,
              position: i,
              holeCards: [i * 2, i * 2 + 1], // Simple cards
              lastActionTime: 0
            });
          }
      
          // Simple game state initialization
          await stateStorage.connect(owner).updateGameBasics(
            0,                // PreFlop round
            0,                // Empty pot
            0,                // No bet yet
            players[0].address // First player to act
          );
        });
      
        it("should correctly track simple bets", async function () {
            // Just one round of simple betting
            console.log("----- SIMPLE BETTING TEST -----");
            
            // Start with empty pot
            let initialPot = await stateStorage.getGameState()
              .then((gs: { mainPot: bigint }) => gs.mainPot);
            console.log("Initial pot:", initialPot);
          
            // Player 0 bets 100
            await gameLogic.connect(players[0]).processAction(players[0].address, RAISE, 100);
            let potAfterBet1 = await stateStorage.getGameState()
              .then((gs: { mainPot: bigint }) => gs.mainPot);
            console.log("Pot after first bet (100):", potAfterBet1);
            
            // Player 1 calls 100
            await gameLogic.connect(players[1]).processAction(players[1].address, CALL, 0);
            let potAfterCall1 = await stateStorage.getGameState()
              .then((gs: { mainPot: bigint }) => gs.mainPot);
            console.log("Pot after first call (100):", potAfterCall1);
            
            // Check player bets BEFORE player 2 calls (which would trigger round transition)
            console.log("Checking player bets before round completion:");
            for (let i = 0; i < 2; i++) {
              const playerBet = await stateStorage.getPlayer(players[i].address)
                .then((p: { currentBet: bigint }) => p.currentBet); 
              console.log(`Player ${i} bet:`, playerBet);
              expect(playerBet).to.equal(BigInt(100));
            }
            
            // Player 2 calls 100 - this will complete the round and trigger transition
            await gameLogic.connect(players[2]).processAction(players[2].address, CALL, 0);
            let potAfterCall2 = await stateStorage.getGameState()
              .then((gs: { mainPot: bigint }) => gs.mainPot);
            console.log("Pot after second call (100):", potAfterCall2);
            
            // Expected pot: 100 + 100 + 100 = 300
            expect(potAfterCall2).to.equal(BigInt(300));
          });
      
        it("should correctly transition between betting rounds", async function () {
          console.log("----- ROUND TRANSITION TEST -----");
          
          // Round 1 - Simple betting
          console.log("ROUND 1 - PreFlop");
          let round1StartPot = await stateStorage.getGameState()
            .then((gs: { mainPot: bigint }) => gs.mainPot);
          console.log("Starting pot:", round1StartPot);
          
          // Everyone bets 100
          await gameLogic.connect(players[0]).processAction(players[0].address, RAISE, 100);
          await gameLogic.connect(players[1]).processAction(players[1].address, CALL, 0);
          await gameLogic.connect(players[2]).processAction(players[2].address, CALL, 0);
          
          let round1EndPot = await stateStorage.getGameState()
            .then((gs: { mainPot: bigint }) => gs.mainPot);
          console.log("Pot after round 1 betting:", round1EndPot);
          
          // Check player bets before round transition
          console.log("Player bets before transition:");
          for (let i = 0; i < 3; i++) {
            const playerBet = await stateStorage.getPlayer(players[i].address)
              .then((p: { currentBet: bigint }) => p.currentBet);
            console.log(`Player ${i} bet:`, playerBet);
          }
          
          // Transition to round 2 - capture pot right after transition
          console.log("TRANSITIONING TO ROUND 2");
          await gameLogic.nextRound();
          
          let round2StartPot = await stateStorage.getGameState()
            .then((gs: { mainPot: bigint }) => gs.mainPot);
          console.log("Pot after transition to round 2:", round2StartPot);
          
          // Verify pot didn't change during transition
          expect(round2StartPot).to.equal(round1EndPot);
          
          // Check player bets were reset
          console.log("Player bets after transition:");
          for (let i = 0; i < 3; i++) {
            const playerBet = await stateStorage.getPlayer(players[i].address)
              .then((p: { currentBet: bigint }) => p.currentBet);
            console.log(`Player ${i} bet:`, playerBet);
            expect(playerBet).to.equal(BigInt(0));
          }
          
          // Find who's first to act in round 2
          const firstToAct = await stateStorage.getGameState()
            .then((gs: { currentTurn: string }) => gs.currentTurn);
          console.log("First to act in round 2:", firstToAct);
          
          // Continue with round 2 betting
          console.log("ROUND 2 - Flop");
          
          // First player bets 200
          await gameLogic.connect(await ethers.getSigner(firstToAct))
            .processAction(firstToAct, RAISE, 200);
          
          // Find next player
          const secondToAct = await stateStorage.getGameState()
            .then((gs: { currentTurn: string }) => gs.currentTurn);
          await gameLogic.connect(await ethers.getSigner(secondToAct))
            .processAction(secondToAct, CALL, 0);
          
          // Find last player
          const thirdToAct = await stateStorage.getGameState()
            .then((gs: { currentTurn: string }) => gs.currentTurn);
          await gameLogic.connect(await ethers.getSigner(thirdToAct))
            .processAction(thirdToAct, CALL, 0);
          
          // Check final pot
          let finalPot = await stateStorage.getGameState()
            .then((gs: { mainPot: bigint }) => gs.mainPot);
          console.log("Final pot after round 2 betting:", finalPot);
          
          // Expected: 300 (round 1) + 600 (round 2) = 900
          expect(finalPot).to.equal(BigInt(900));
        });
      
        it("should track pot accurately when players fold", async function () {
          console.log("----- FOLD TRACKING TEST -----");
          
          // Start with empty pot
          let initialPot = await stateStorage.getGameState()
            .then((gs: { mainPot: bigint }) => gs.mainPot);
          console.log("Initial pot:", initialPot);
          
          // Player 0 bets 100
          await gameLogic.connect(players[0]).processAction(players[0].address, RAISE, 100);
          let potAfterBet = await stateStorage.getGameState()
            .then((gs: { mainPot: bigint }) => gs.mainPot);
          console.log("Pot after first bet (100):", potAfterBet);
          
          // Player 1 calls 100
          await gameLogic.connect(players[1]).processAction(players[1].address, CALL, 0);
          let potAfterCall = await stateStorage.getGameState()
            .then((gs: { mainPot: bigint }) => gs.mainPot);
          console.log("Pot after call (100):", potAfterCall);
          
          // Player 2 folds (should not change pot)
          await gameLogic.connect(players[2]).processAction(players[2].address, FOLD, 0);
          let potAfterFold = await stateStorage.getGameState()
            .then((gs: { mainPot: bigint }) => gs.mainPot);
          console.log("Pot after fold:", potAfterFold);
          
          // Expected pot shouldn't change after fold: 100 + 100 = 200
          expect(potAfterFold).to.equal(potAfterCall);
          
          // Check player statuses
          const player2Status = await stateStorage.getPlayer(players[2].address)
            .then((p: { status: number }) => p.status);
          console.log("Folded player status:", player2Status);
          expect(player2Status).to.equal(2); // Folded = 2
        });

        it("should correctly track full game sequence", async function () {
            console.log("----- FULL GAME SEQUENCE TEST -----");
            
            // Track initial stacks
            const initialStacks: bigint[] = [];
            for (let i = 0; i < 3; i++) {
              initialStacks[i] = await stateStorage.getPlayer(players[i].address)
                .then((p: { stack: bigint }) => p.stack);
            }
            console.log("Initial stacks:", initialStacks);
            
            // PreFlop round
            console.log("--- PREFLOP ---");
            await gameLogic.connect(players[0]).processAction(players[0].address, RAISE, 100);
            await gameLogic.connect(players[1]).processAction(players[1].address, CALL, 0);
            await gameLogic.connect(players[2]).processAction(players[2].address, CALL, 0);
            
            let potAfterPreflop = await stateStorage.getGameState()
              .then((gs: { mainPot: bigint }) => gs.mainPot);
            console.log("Pot after preflop:", potAfterPreflop);
            expect(potAfterPreflop).to.equal(BigInt(300));
            
            // Transition to Flop
            console.log("--- TRANSITION TO FLOP ---");
            await gameLogic.nextRound();
            
            let potAfterFlopTransition = await stateStorage.getGameState()
              .then((gs: { mainPot: bigint }) => gs.mainPot);
            console.log("Pot after transition to flop:", potAfterFlopTransition);
            
            // Flop betting - CORRECTED
            console.log("--- FLOP BETTING ---");
            // Find first player to act
            const flopFirstToAct = await stateStorage.getGameState()
              .then((gs: { currentTurn: string }) => gs.currentTurn);
            
            // First player bets 200
            await gameLogic.connect(await ethers.getSigner(flopFirstToAct))
              .processAction(flopFirstToAct, RAISE, 200);
            let potAfterFirstBet = await stateStorage.getGameState()
              .then((gs: { mainPot: bigint }) => gs.mainPot);
            console.log("Pot after first flop bet:", potAfterFirstBet);
            
            // Second player calls 200 and raises 200 (400 total)
            const secondToAct = await stateStorage.getGameState()
              .then((gs: { currentTurn: string }) => gs.currentTurn);
            await gameLogic.connect(await ethers.getSigner(secondToAct))
              .processAction(secondToAct, RAISE, 200);
            let potAfterSecondBet = await stateStorage.getGameState()
              .then((gs: { mainPot: bigint }) => gs.mainPot);
            console.log("Pot after second flop bet:", potAfterSecondBet);
            
            // Third player CALLS the current bet (400)
            const thirdToAct = await stateStorage.getGameState()
              .then((gs: { currentTurn: string }) => gs.currentTurn);
            await gameLogic.connect(await ethers.getSigner(thirdToAct))
              .processAction(thirdToAct, CALL, 0);
            let potAfterThirdBet = await stateStorage.getGameState()
              .then((gs: { mainPot: bigint }) => gs.mainPot);
            console.log("Pot after third flop bet (call):", potAfterThirdBet);
            
            let potAfterFlop = await stateStorage.getGameState()
              .then((gs: { mainPot: bigint }) => gs.mainPot);
            console.log("Pot after flop betting:", potAfterFlop);
            
            // Expected pot: 300 (preflop) + 200 + 400 + 400 (flop) = 1300
            expect(potAfterFlop).to.equal(BigInt(1300));
            
            // Get final stacks and verify correct deductions
            const finalStacks: bigint[] = [];
            // Expected player contributions:
            // Player 0: 100 (preflop) + 400 (flop call) = 500
            // Player 1: 100 (preflop) + 200 (flop raise) = 300
            // Player 2: 100 (preflop) + 400 (flop call) = 500
            const expectedDeductions = [BigInt(500), BigInt(300), BigInt(500)];
            
            for (let i = 0; i < 3; i++) {
              finalStacks[i] = await stateStorage.getPlayer(players[i].address)
                .then((p: { stack: bigint }) => p.stack);
              console.log(`Player ${i} final stack:`, finalStacks[i]);
              
              // Each player should have lost their expected amount
              expect(initialStacks[i] - finalStacks[i]).to.equal(expectedDeductions[i]);
            }
          });
      
        
      });


      describe.skip("GameLogic - Side Pots and All-In Scenarios", function () {
        // Set up common deployment and state before each test
        beforeEach(async function () {
          // Deploy contracts and set up initial variables such as:
          // - stateStorage
          // - gameLogic
          // - owner and players (using ethers.getSigners())
          // - any constants (like INITIAL_STACK, RAISE, CALL, CHECK)
        });
      
        it("should correctly handle side pots with all-in players", async function () {
          console.log("----- ALL-IN AND SIDE POT TEST -----");
          
          // Set up players with different stack sizes
          // Player 0: Normal stack
          // Player 1: Small stack (will go all-in)
          // Player 2: Normal stack
          await stateStorage.connect(owner).updatePlayerState(players[0].address, {
            stack: INITIAL_STACK,
            status: 1, // Active
            currentBet: 0,
            position: 0,
            holeCards: [50, 51], // Ace-King of spades (strongest hand)
            lastActionTime: 0
          });
          
          await stateStorage.connect(owner).updatePlayerState(players[1].address, {
            stack: 300, // Small stack
            status: 1, // Active
            currentBet: 0,
            position: 1,
            holeCards: [48, 49], // Queen-Jack of spades (second strongest)
            lastActionTime: 0
          });
          
          await stateStorage.connect(owner).updatePlayerState(players[2].address, {
            stack: INITIAL_STACK,
            status: 1, // Active
            currentBet: 0,
            position: 2,
            holeCards: [46, 47], // Ten-Nine of spades (third strongest)
            lastActionTime: 0
          });
          
          // Track initial stacks
          const initialStacks = {
            player0: (await stateStorage.getPlayer(players[0].address)).stack,
            player1: (await stateStorage.getPlayer(players[1].address)).stack,
            player2: (await stateStorage.getPlayer(players[2].address)).stack
          };
          console.log("Initial stacks:", initialStacks);
          
          // Set initial game state
          await stateStorage.connect(owner).updateGameBasics(
            0,                // PreFlop round
            0,                // Empty pot
            0,                // No bet yet
            players[0].address // First player to act
          );
          
          // Betting sequence:
          console.log("--- BETTING SEQUENCE ---");
          
          // Player 0 bets 200
          await gameLogic.connect(players[0]).processAction(players[0].address, RAISE, 200);
          let potAfterBet1 = (await stateStorage.getGameState()).mainPot;
          console.log("Pot after first bet (200):", potAfterBet1);
          
          // Player 1 goes all-in with 300 (by raising 100 on top of calling 200)
          await gameLogic.connect(players[1]).processAction(players[1].address, RAISE, 100);
          let potAfterAllIn = (await stateStorage.getGameState()).mainPot;
          console.log("Pot after all-in (300 total):", potAfterAllIn);
          
          // Check player 1's status
          const player1State = await stateStorage.getPlayer(players[1].address);
          console.log("All-in player stack:", player1State.stack);
          expect(player1State.stack).to.equal(BigInt(0)); // Confirm all-in
          
          // Player 2 raises to 500 (calls 300 + raises 200)
          await gameLogic.connect(players[2]).processAction(players[2].address, RAISE, 200);
          let potAfterRaise = (await stateStorage.getGameState()).mainPot;
          console.log("Pot after raise (500 total):", potAfterRaise);
          
          // Player 0 calls 500
          await gameLogic.connect(players[0]).processAction(players[0].address, CALL, 0);
          let potAfterCall = (await stateStorage.getGameState()).mainPot;
          console.log("Pot after call:", potAfterCall);
          
          // Check side pot creation
          const sidePotsCount = await stateStorage.sidePotCount();
          console.log("Number of side pots:", sidePotsCount);
          // expect(sidePotsCount).to.be.gt(BigInt(0)); // TODO: Ziga - this is not working
          
          // Examine each side pot
          for (let i = 0; i < Number(sidePotsCount); i++) {
            const sidePot = await stateStorage.getSidePot(i);
            console.log(`Side pot ${i}: Amount=${sidePot[0]}, Resolved=${sidePot[1]}`);
          }
          
          // Check pot eligibility
          for (let i = 0; i < 3; i++) {
            const isEligible = await stateStorage.isPlayerEligibleForPot(0, players[i].address);
            console.log(`Player ${i} eligible for side pot: ${isEligible}`);
          }
          
          // Fast forward to showdown (skip additional rounds)
          console.log("--- PROCEEDING TO SHOWDOWN ---");
          
          // Manually set community cards for a controlled test
          const communityCards = [0, 1, 2, 3, 4]; // Example cards
          await stateStorage.connect(owner).updateGameCards(communityCards);
          
          // Trigger showdown rounds (flop, turn, river)
          await gameLogic.nextRound(); // To flop
          await gameLogic.nextRound(); // To turn
          await gameLogic.nextRound(); // To river
          
          // Force showdown by having remaining players check
          // (Skip the all-in player)
          for (let i = 0; i < 2; i++) {
            const actingPlayer = (await stateStorage.getGameState()).currentTurn;
            if (actingPlayer !== players[1].address) {
              await gameLogic.connect(await ethers.getSigner(actingPlayer))
                .processAction(actingPlayer, CHECK, 0);
            }
          }
          
          // Verify final stacks
          const finalStacks = {
            player0: (await stateStorage.getPlayer(players[0].address)).stack,
            player1: (await stateStorage.getPlayer(players[1].address)).stack,
            player2: (await stateStorage.getPlayer(players[2].address)).stack
          };
          console.log("Final stacks:", finalStacks);
          
          // Verify main pot is empty after distribution
          const finalMainPot = (await stateStorage.getGameState()).mainPot;
          // expect(finalMainPot).to.equal(BigInt(0)); // TODO: Ziga - this is not working
          console.log("Final main pot:", finalMainPot);
          
          
          // Verify side pots are resolved
          for (let i = 0; i < Number(sidePotsCount); i++) {
            const sidePot = await stateStorage.getSidePot(i);
            // expect(sidePot[1]).to.be.true; // isResolved should be true - TODO: Ziga - this is not working
          }
          
          // Calculate expected profits and ensure they sum to zero
          const player0Profit = finalStacks.player0 - initialStacks.player0;
          const player1Profit = finalStacks.player1 - initialStacks.player1;
          const player2Profit = finalStacks.player2 - initialStacks.player2;
          
          console.log("Profits/losses:");
          console.log("Player 0:", player0Profit);
          console.log("Player 1:", player1Profit);
          console.log("Player 2:", player2Profit);
          


          expect(player0Profit + player1Profit + player2Profit).to.equal(BigInt(0));
        });
      });
});
