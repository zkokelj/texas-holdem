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
});
