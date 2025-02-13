import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Test suite for poker game smart contract focusing on player order and betting mechanics
 * Tests cover both pre-flop and post-flop scenarios in a 5-player poker game
 */
describe("GameLogic - Player Order", function () {
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

        // Initialize the game state with players and positions
        await setupGameState();
    });

    /**
     * Sets up the initial game state for testing
     * - Places 5 players in their positions
     * - Sets up initial stacks and blind bets
     * - Initializes the pre-flop round
     */
    async function setupGameState() {
        // Initialize each player's state
        for (let i = 0; i < 5; i++) {
            let currentBet = 0;
            let stack = INITIAL_STACK;

            // Deduct and set blind bets for SB and BB positions
            if (i === SB) {
                currentBet = SMALL_BLIND;
                stack = INITIAL_STACK - SMALL_BLIND;
            } else if (i === BB) {
                currentBet = BIG_BLIND;
                stack = INITIAL_STACK - BIG_BLIND;
            }

            // Update state for each player with their position and stack
            await stateStorage.connect(owner).updatePlayerState(players[i].address, {
                stack: stack,
                status: 1,         // 1 = Active player
                currentBet: currentBet,
                position: i,
                holeCards: [0, 0], // No cards dealt yet
                lastActionTime: 0
            });
        }

        // Initialize the game state for pre-flop round
        await stateStorage.connect(owner).updateGameBasics(
            0,                      // 0 = PreFlop round
            BIG_BLIND,             // Current pot size
            BIG_BLIND,             // Current bet to call
            players[UTG].address   // UTG starts the action pre-flop
        );
    }


    async function verifyPlayerPositions() {
        console.log("\nVerifying all player positions:");
        for (let i = 0; i < 5; i++) {
            const addr = await stateStorage.getPlayerAtPosition(i);
            const player = await stateStorage.getPlayer(addr);
            console.log(`Position ${i}:
                Address: ${addr}
                Stored Position: ${player.position}
                Status: ${player.status}
                Stack: ${player.stack}
            `);
        }
    }

    /**
     * Tests for pre-flop betting order
     * Pre-flop betting starts with UTG and moves clockwise
     */
    describe("Pre-flop Action Order", function () {
        // Verify UTG starts the action pre-flop
        it("Should start with UTG in pre-flop", async function () {
            const gameState = await stateStorage.getGameState();
            expect(gameState.currentTurn).to.equal(players[UTG].address);
        });

        // Test complete pre-flop betting round with all players calling
        it("Should follow correct pre-flop order: UTG -> MP -> BTN -> SB -> BB", async function () {
            // Track and verify each player's turn in order
            let currentTurn = (await stateStorage.getGameState()).currentTurn;
            expect(currentTurn).to.equal(players[UTG].address);

            // Test the sequence of actions
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);
            currentTurn = (await stateStorage.getGameState()).currentTurn;
            expect(currentTurn).to.equal(players[MP].address);

            await gameLogic.connect(players[MP]).processAction(players[MP].address, CALL, 0);
            currentTurn = (await stateStorage.getGameState()).currentTurn;
            expect(currentTurn).to.equal(players[BUTTON].address);

            await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, CALL, 0);
            currentTurn = (await stateStorage.getGameState()).currentTurn;
            expect(currentTurn).to.equal(players[SB].address);

            await gameLogic.connect(players[SB]).processAction(players[SB].address, CALL, 0);
            currentTurn = (await stateStorage.getGameState()).currentTurn;
            expect(currentTurn).to.equal(players[BB].address);

            await gameLogic.connect(players[BB]).processAction(players[BB].address, CHECK, 0);

            // Verify pre-flop round completion
            const finalGameState = await stateStorage.getGameState();
            expect(finalGameState.currentRound).to.equal(1); // Check if moved to flop
            expect(finalGameState.currentBet).to.equal(0); // Verify bets are reset
            expect(finalGameState.currentTurn).to.equal(players[SB].address); // Small Blind is next to act
        });
    });

    /**
     * Tests for post-flop betting order
     * Post-flop betting starts with SB and moves clockwise
     */
    describe("Post-flop Action Order", function () {
        // Set up the flop round before each test
        beforeEach(async function () {
            // Complete pre-flop round with all players calling
            for (let pos of [UTG, MP, BUTTON, SB]) {
                await gameLogic.connect(players[pos]).processAction(players[pos].address, CALL, 0);
            }
            await gameLogic.connect(players[BB]).processAction(players[BB].address, CHECK, 0);

            // Advance to flop
            await gameLogic.nextRound();
        });

        // Test post-flop betting order
        it("Should start with SB in post-flop rounds", async function () {
            const gameState = await stateStorage.getGameState();
            expect(gameState.currentTurn).to.equal(players[SB].address);
        });
    });

    /**
     * Tests for correct handling of folded players
     * System should skip folded players when determining next turn
     */
    describe("Player Order with Folds", function () {
        // Test fold handling pre-flop
        it("Should skip folded players in pre-flop", async function () {
            // UTG folds, should move to MP
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, FOLD, 0);
            let currentTurn = (await stateStorage.getGameState()).currentTurn;
            expect(currentTurn).to.equal(players[MP].address);

            // MP calls, should skip folded UTG
            await gameLogic.connect(players[MP]).processAction(players[MP].address, CALL, 0);
            currentTurn = (await stateStorage.getGameState()).currentTurn;
            expect(currentTurn).to.equal(players[BUTTON].address);
        });

        // Test fold handling post-flop
        it("Should skip folded players in post-flop", async function () {
            // Complete pre-flop round
            for (let pos of [UTG, MP, BUTTON, SB]) {
                await gameLogic.connect(players[pos]).processAction(players[pos].address, CALL, 0);
            }
            await gameLogic.connect(players[BB]).processAction(players[BB].address, CHECK, 0);

            await gameLogic.nextRound();

            // SB folds, should move to BB
            await gameLogic.connect(players[SB]).processAction(players[SB].address, FOLD, 0);
            let currentTurn = (await stateStorage.getGameState()).currentTurn;
            expect(currentTurn).to.equal(players[BB].address);

            // BB checks, should skip folded SB
            await gameLogic.connect(players[BB]).processAction(players[BB].address, CHECK, 0);
            currentTurn = (await stateStorage.getGameState()).currentTurn;
            expect(currentTurn).to.equal(players[UTG].address);
        });
    });

    /**
     * Tests for correct handling of betting round transitions
     * Verifies proper state updates when moving to next round
     */
    describe("Betting Round Transitions", function () {
        // Test round advancement conditions
        it("Should move to next round when all active players have matched the bet", async function () {
            // Complete pre-flop betting round
            for (let pos of [UTG, MP, BUTTON, SB]) {
                await gameLogic.connect(players[pos]).processAction(players[pos].address, CALL, 0);
            }
            await gameLogic.connect(players[BB]).processAction(players[BB].address, CHECK, 0);

            const finalState = await stateStorage.getGameState();
            expect(finalState.currentRound).to.equal(1); // 1 = Flop round
            expect(finalState.currentTurn).to.equal(players[SB].address); // SB starts post-flop
        });

    });

    describe("Full Game Flow", function () {
        // Test complete game flow with all players calling each round
        it("Should complete all betting rounds with correct order: pre-flop -> flop -> turn -> river", async function () {
            // Pre-flop round
            let currentTurn = (await stateStorage.getGameState()).currentTurn;
            console.log("\nStarting pre-flop round");
            console.log("Initial turn:", currentTurn);
            expect(currentTurn).to.equal(players[UTG].address);

            // All players call pre-flop
            for (let pos of [UTG, MP, BUTTON]) {
                console.log(`\nPlayer at position ${pos} calling`);
                await gameLogic.connect(players[pos]).processAction(players[pos].address, CALL, 0);
                currentTurn = (await stateStorage.getGameState()).currentTurn;
                console.log("Next turn:", currentTurn);
                expect(currentTurn).to.equal(players[(pos + 1) % 5].address);
            }

            // SB completes the call
            console.log("\nSB calling");
            await gameLogic.connect(players[SB]).processAction(players[SB].address, CALL, 0);
            currentTurn = (await stateStorage.getGameState()).currentTurn;
            console.log("After SB call, turn:", currentTurn);
            expect(currentTurn).to.equal(players[BB].address);

            // BB checks to end pre-flop
            console.log("\nBB checking");
            await gameLogic.connect(players[BB]).processAction(players[BB].address, CHECK, 0);

            // Verify flop round started
            let gameState = await stateStorage.getGameState();
            console.log("\nAfter BB check, game state:", {
                currentRound: gameState.currentRound,
                currentTurn: gameState.currentTurn,
                currentBet: gameState.currentBet,
                mainPot: gameState.mainPot
            });

            expect(gameState.currentRound).to.equal(1); // Flop round
            expect(gameState.currentTurn).to.equal(players[SB].address); // SB starts post-flop
            expect(gameState.currentBet).to.equal(0); // Bets reset

            console.log("\nFlop round started!");

            // Flop round - SB raises, others call
            console.log("\nSB raising in flop");
            await gameLogic.connect(players[SB]).processAction(players[SB].address, RAISE, 100);
            currentTurn = (await stateStorage.getGameState()).currentTurn;
            console.log("After SB raise, turn:", currentTurn);
            expect(currentTurn).to.equal(players[BB].address);

            // BB calls
            console.log("\nBB calling");
            await gameLogic.connect(players[BB]).processAction(players[BB].address, CALL, 0);
            currentTurn = (await stateStorage.getGameState()).currentTurn;
            console.log("After BB call, turn:", currentTurn);
            expect(currentTurn).to.equal(players[UTG].address);

            // UTG calls
            console.log("\nUTG calling");
            await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);
            currentTurn = (await stateStorage.getGameState()).currentTurn;
            console.log("After UTG call, turn:", currentTurn);
            expect(currentTurn).to.equal(players[MP].address);

            // MP calls
            console.log("\nMP calling");
            await gameLogic.connect(players[MP]).processAction(players[MP].address, CALL, 0);
            currentTurn = (await stateStorage.getGameState()).currentTurn;
            console.log("After MP call, turn:", currentTurn);
            expect(currentTurn).to.equal(players[BUTTON].address);

            // BUTTON calls to end flop
            console.log("\nBUTTON calling to end flop");
            await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, CALL, 0);

            // Verify turn round started
            gameState = await stateStorage.getGameState();
            console.log("\nAfter BUTTON call, game state:", {
                currentRound: gameState.currentRound,
                currentTurn: gameState.currentTurn,
                currentBet: gameState.currentBet,
                mainPot: gameState.mainPot,
                communityCards: gameState.communityCards
            });

            expect(gameState.currentRound).to.equal(2); // Turn round
            expect(gameState.currentTurn).to.equal(players[SB].address);

            console.log("\nTurn round started!");

            // Test complete game flow with all players calling each round
            // it("Should complete all betting rounds with correct order: pre-flop -> flop -> turn -> river", async function () {
            //     // Pre-flop round
            //     let currentTurn = (await stateStorage.getGameState()).currentTurn;
            //     console.log("\nStarting pre-flop round");
            //     console.log("Initial turn:", currentTurn);
            //     expect(currentTurn).to.equal(players[UTG].address);

            //     // All players call pre-flop
            //     for (let pos of [UTG, MP, BUTTON]) {
            //         console.log(`\nPlayer at position ${pos} calling`);
            //         await gameLogic.connect(players[pos]).processAction(players[pos].address, CALL, 0);
            //         currentTurn = (await stateStorage.getGameState()).currentTurn;
            //         console.log("Next turn:", currentTurn);
            //         expect(currentTurn).to.equal(players[(pos + 1) % 5].address);
            //     }

            //     // SB completes the call
            //     console.log("\nSB calling");
            //     await gameLogic.connect(players[SB]).processAction(players[SB].address, CALL, 0);
            //     currentTurn = (await stateStorage.getGameState()).currentTurn;
            //     console.log("After SB call, turn:", currentTurn);
            //     expect(currentTurn).to.equal(players[BB].address);

            //     // BB checks to end pre-flop
            //     console.log("\nBB checking");
            //     await gameLogic.connect(players[BB]).processAction(players[BB].address, CHECK, 0);

            //     // Verify flop round started
            //     let gameState = await stateStorage.getGameState();
            //     console.log("\nAfter BB check, game state:", {
            //         currentRound: gameState.currentRound,
            //         currentTurn: gameState.currentTurn,
            //         currentBet: gameState.currentBet,
            //         mainPot: gameState.mainPot
            //     });

            //     expect(gameState.currentRound).to.equal(1); // Flop round
            //     expect(gameState.currentTurn).to.equal(players[SB].address); // SB starts post-flop
            //     expect(gameState.currentBet).to.equal(0); // Bets reset

            //     console.log("\nFlop round started!");

            //     // Flop round - everyone checks
            //     for (let pos of [SB, BB, UTG, MP]) {
            //         console.log(`\nPlayer at position ${pos} checking`);
            //         await gameLogic.connect(players[pos]).processAction(players[pos].address, CHECK, 0);
            //         currentTurn = (await stateStorage.getGameState()).currentTurn;
            //         console.log("After check, turn:", currentTurn);
            //         expect(currentTurn).to.equal(players[(pos + 1) % 5].address);
            //     }

            //     // BUTTON checks to end flop
            //     console.log("\nBUTTON checking to end flop");
            //     await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, CHECK, 0);

            //     // Verify turn round started
            //     gameState = await stateStorage.getGameState();
            //     console.log("\nAfter BUTTON check, game state:", {
            //         currentRound: gameState.currentRound,
            //         currentTurn: gameState.currentTurn,
            //         currentBet: gameState.currentBet,
            //         mainPot: gameState.mainPot,
            //         communityCards: gameState.communityCards
            //     });

            //     expect(gameState.currentRound).to.equal(2); // Turn round
            //     expect(gameState.currentTurn).to.equal(players[SB].address);
            // });

            // Test complete game flow with raises in each round
            // it("Should handle raises correctly across all betting rounds", async function () {
            //     // Pre-flop round with raises
            //     await gameLogic.connect(players[UTG]).processAction(players[UTG].address, RAISE, 150); // Raise to 150
            //     await gameLogic.connect(players[MP]).processAction(players[MP].address, CALL, 0);
            //     await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, RAISE, 450); // Re-raise to 450
            //     await gameLogic.connect(players[SB]).processAction(players[SB].address, CALL, 0);
            //     await gameLogic.connect(players[BB]).processAction(players[BB].address, CALL, 0);
            //     await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);
            //     await gameLogic.connect(players[MP]).processAction(players[MP].address, CALL, 0);

            //     // Verify flop round started correctly
            //     let gameState = await stateStorage.getGameState();
            //     expect(gameState.currentRound).to.equal(1);
            //     expect(gameState.currentTurn).to.equal(players[SB].address);
            //     expect(gameState.currentBet).to.equal(0);

            //     // Flop round with raises
            //     await gameLogic.connect(players[SB]).processAction(players[SB].address, CHECK, 0);
            //     await gameLogic.connect(players[BB]).processAction(players[BB].address, RAISE, 200);
            //     await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);
            //     await gameLogic.connect(players[MP]).processAction(players[MP].address, RAISE, 600);
            //     await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, CALL, 0);
            //     await gameLogic.connect(players[SB]).processAction(players[SB].address, CALL, 0);
            //     await gameLogic.connect(players[BB]).processAction(players[BB].address, CALL, 0);
            //     await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);

            //     // Verify turn round started
            //     gameState = await stateStorage.getGameState();
            //     expect(gameState.currentRound).to.equal(2);
            //     expect(gameState.currentTurn).to.equal(players[SB].address);

            //     // Turn round with a raise
            //     await gameLogic.connect(players[SB]).processAction(players[SB].address, CHECK, 0);
            //     await gameLogic.connect(players[BB]).processAction(players[BB].address, CHECK, 0);
            //     await gameLogic.connect(players[UTG]).processAction(players[UTG].address, RAISE, 800);
            //     await gameLogic.connect(players[MP]).processAction(players[MP].address, CALL, 0);
            //     await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, CALL, 0);
            //     await gameLogic.connect(players[SB]).processAction(players[SB].address, FOLD, 0);
            //     await gameLogic.connect(players[BB]).processAction(players[BB].address, CALL, 0);

            //     // Verify river round started
            //     gameState = await stateStorage.getGameState();
            //     expect(gameState.currentRound).to.equal(3);
            //     expect(gameState.currentTurn).to.equal(players[BB].address); // SB folded, so BB starts

            //     // River round - check through
            //     for (let pos of [BB, UTG, MP, BUTTON]) {
            //         await gameLogic.connect(players[pos]).processAction(players[pos].address, CHECK, 0);
            //     }

            //     // Verify hand is complete
            //     gameState = await stateStorage.getGameState();
            //     expect(gameState.currentRound).to.equal(4);
        });

        // Test game flow with mixed actions (calls, raises, and folds)
        // it("Should handle mixed actions correctly across rounds", async function () {
        //     // Pre-flop round
        //     await gameLogic.connect(players[UTG]).processAction(players[UTG].address, RAISE, 150);
        //     await gameLogic.connect(players[MP]).processAction(players[MP].address, FOLD, 0);
        //     await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, CALL, 0);
        //     await gameLogic.connect(players[SB]).processAction(players[SB].address, FOLD, 0);
        //     await gameLogic.connect(players[BB]).processAction(players[BB].address, CALL, 0);

        //     // Verify flop round with correct active players
        //     let gameState = await stateStorage.getGameState();
        //     expect(gameState.currentRound).to.equal(1);
        //     expect(gameState.currentTurn).to.equal(players[BB].address); // BB starts as SB folded

        //     // Flop round
        //     await gameLogic.connect(players[BB]).processAction(players[BB].address, CHECK, 0);
        //     await gameLogic.connect(players[UTG]).processAction(players[UTG].address, RAISE, 300);
        //     await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, CALL, 0);
        //     await gameLogic.connect(players[BB]).processAction(players[BB].address, FOLD, 0);

        //     // Verify turn round with remaining players
        //     gameState = await stateStorage.getGameState();
        //     expect(gameState.currentRound).to.equal(2);
        //     expect(gameState.currentTurn).to.equal(players[UTG].address); // UTG starts as BB folded

        //     // Complete hand with remaining players
        //     await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CHECK, 0);
        //     await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, CHECK, 0);

        //     // Verify river round
        //     gameState = await stateStorage.getGameState();
        //     expect(gameState.currentRound).to.equal(3);

        //     // River round
        //     await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CHECK, 0);
        //     await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, CHECK, 0);

        //     // Verify hand complete
        //     gameState = await stateStorage.getGameState();
        //     expect(gameState.currentRound).to.equal(4);
        // });
    });
});