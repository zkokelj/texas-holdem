// test/Integration.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { StateStorage, HandManager, HandEvaluator, GameLogic, TournamentLogic } from "../typechain-types";

describe("Integration Tests", function () {
    let stateStorage: StateStorage;
    let handManager: HandManager;
    let handEvaluator: HandEvaluator;
    let gameLogic: GameLogic;
    let tournamentLogic: TournamentLogic;
    let owner: Signer;
    let players: Signer[];

    // Constants (matching those used in contracts)
    const INITIAL_STACK = 10000;
    const SMALL_BLIND = 25;
    const BIG_BLIND = 50;
    // Action codes
    const FOLD = 0;
    const CHECK = 1;
    const CALL = 2;
    const RAISE = 3;

    beforeEach(async function () {
        [owner, ...players] = await ethers.getSigners();

        // Deploy StateStorage first
        const StateStorage = await ethers.getContractFactory("StateStorage");
        stateStorage = await StateStorage.connect(owner).deploy();

        // Deploy HandManager
        const HandManager = await ethers.getContractFactory("HandManager");
        handManager = await HandManager.connect(owner).deploy(await stateStorage.getAddress());

        // Deploy HandEvaluator
        const HandEvaluator = await ethers.getContractFactory("HandEvaluator");
        handEvaluator = await HandEvaluator.connect(owner).deploy();

        // Deploy GameLogic
        const GameLogic = await ethers.getContractFactory("GameLogic");
        gameLogic = await GameLogic.connect(owner).deploy(
            await stateStorage.getAddress(),
            await handManager.getAddress(),
            await handEvaluator.getAddress()
        );

        // Deploy TournamentLogic
        const TournamentLogic = await ethers.getContractFactory("TournamentLogic");
        tournamentLogic = await TournamentLogic.connect(owner).deploy(await stateStorage.getAddress());

        // Authorize contracts in stateStorage
        await stateStorage.connect(owner).authorizeContract(await owner.getAddress());
        await stateStorage.connect(owner).authorizeContract(await gameLogic.getAddress());
        await stateStorage.connect(owner).authorizeContract(await handManager.getAddress());
        await stateStorage.connect(owner).authorizeContract(await tournamentLogic.getAddress());

        // Setup initial game state
        await setupInitialGameState();
    });

    async function setupInitialGameState() {
        // Initialize players with starting stacks for 5 positions
        for (let i = 0; i < 5; i++) {
            if (i < players.length) {
                let currentBet = 0;
                let stack = INITIAL_STACK;
                // Set BB's current bet for player in position 1
                if (i === 1) {
                    currentBet = BIG_BLIND;
                    stack = INITIAL_STACK - BIG_BLIND;
                }
                await stateStorage.updatePlayerState(
                    await players[i].getAddress(),
                    {
                        stack: stack,
                        status: 1, // Active
                        currentBet: currentBet,
                        position: i,
                        holeCards: [0, 0] as [number, number],
                        lastActionTime: 0
                    }
                );
            }
        }

        // Set initial game state:
        // - Round: PreFlop (assumed enum value 0)
        // - mainPot: BIG_BLIND (simulate BB already posted)
        // - currentBet: BIG_BLIND
        // - currentTurn: players[2] (for example)
        await stateStorage.updateGameBasics(
            0, // PreFlop
            BIG_BLIND, // mainPot
            BIG_BLIND, // currentBet
            await players[2].getAddress()
        );
    }

    describe("Full Game Flow", function () {
        it("Should complete a full hand successfully", async function () {
            // Preflop betting: simulate that all players call.
            await gameLogic.connect(players[2]).processAction(await players[2].getAddress(), CALL, 0);
            await gameLogic.connect(players[3]).processAction(await players[3].getAddress(), CALL, 0);
            await gameLogic.connect(players[4]).processAction(await players[4].getAddress(), CALL, 0);
            await gameLogic.connect(players[0]).processAction(await players[0].getAddress(), CALL, 0);
            await gameLogic.connect(players[1]).processAction(await players[1].getAddress(), CALL, 0);

            // Progress to the Flop round
            await gameLogic.nextRound();

            // Flop: all players check.
            for (let i = 0; i < 5; i++) {
                await gameLogic.connect(players[i]).processAction(await players[i].getAddress(), CHECK, 0);
            }
            await gameLogic.nextRound(); // Move to Turn

            // Turn: all players check.
            for (let i = 0; i < 5; i++) {
                await gameLogic.connect(players[i]).processAction(await players[i].getAddress(), CHECK, 0);
            }
            await gameLogic.nextRound(); // Move to River

            // River: all players check.
            for (let i = 0; i < 5; i++) {
                await gameLogic.connect(players[i]).processAction(await players[i].getAddress(), CHECK, 0);
            }
            // Final round – showdown should be triggered when nextRound is called in River.
            await gameLogic.nextRound();

            // After showdown, mainPot should be awarded and set to 0.
            const gameState = await stateStorage.getGameState();
            expect(gameState.mainPot).to.equal(0);
        });

        it("Should handle multiple rounds of betting", async function () {
            const raiseAmount = 50;
            // Preflop: players[2] raises.
            await gameLogic.connect(players[2]).processAction(await players[2].getAddress(), RAISE, raiseAmount);
            // The rest call.
            for (let i = 0; i < 5; i++) {
                if (i !== 2) {
                    await gameLogic.connect(players[i]).processAction(await players[i].getAddress(), CALL, 0);
                }
            }
            await gameLogic.nextRound(); // Flop

            // Flop: players[3] raises.
            await gameLogic.connect(players[3]).processAction(await players[3].getAddress(), RAISE, raiseAmount);
            for (let i = 0; i < 5; i++) {
                if (i !== 3) {
                    await gameLogic.connect(players[i]).processAction(await players[i].getAddress(), CALL, 0);
                }
            }
            await gameLogic.nextRound(); // Turn

            // Turn: all players check.
            for (let i = 0; i < 5; i++) {
                await gameLogic.connect(players[i]).processAction(await players[i].getAddress(), CHECK, 0);
            }
            await gameLogic.nextRound(); // River

            // River: players[0] raises, others call.
            await gameLogic.connect(players[0]).processAction(await players[0].getAddress(), RAISE, raiseAmount);
            for (let i = 1; i < 5; i++) {
                await gameLogic.connect(players[i]).processAction(await players[i].getAddress(), CALL, 0);
            }
            await gameLogic.nextRound(); // Should trigger showdown.

            const gameState = await stateStorage.getGameState();
            expect(gameState.mainPot).to.equal(0);
        });

        it("Should process showdown correctly", async function () {
            // Manually set player[0]'s hole cards to force a winning hand.
            await stateStorage.updatePlayerState(await players[0].getAddress(), {
                stack: INITIAL_STACK,
                status: 1,
                currentBet: 0,
                position: 0,
                holeCards: [3, 16],
                lastActionTime: 0
            });
            // Set community cards manually.
            await stateStorage.updateGameCards([29, 11, 24, 0, 1]);

            // Force the game round to River (assumed enum value 3)
            await stateStorage.updateGameBasics(
                3,
                1000, // mainPot
                0,
                await players[0].getAddress()
            );
            // Calling nextRound should trigger showdown.
            await gameLogic.nextRound();

            // After showdown, mainPot should be zero and player[0]'s stack should have increased.
            const gameState = await stateStorage.getGameState();
            const player0State = await stateStorage.getPlayer(await players[0].getAddress());
            expect(gameState.mainPot).to.equal(0);
            expect(player0State.stack).to.be.gt(INITIAL_STACK);
        });
    });

    describe("Tournament Flow", function () {
        beforeEach(async function () {
            // Start a tournament using TournamentLogic with the first 5 players.
            const playerAddrs = [];
            for (let i = 0; i < 5; i++) {
                playerAddrs.push(await players[i].getAddress());
            }
            await tournamentLogic.startTournament(playerAddrs);
        });

        it("Should complete a mini tournament", async function () {
            // Simulate a mini tournament by eliminating players.
            // Mark players[1], [2], and [3] as eliminated.
            for (let i = 1; i <= 3; i++) {
                await stateStorage.updatePlayerState(await players[i].getAddress(), {
                    stack: 0,
                    status: 3, // Eliminated
                    currentBet: 0,
                    position: i,
                    holeCards: [0, 0],
                    lastActionTime: 0
                });
            }
            // Update tournament state to reflect only 2 active players.
            await stateStorage.updateTournamentStatus(1, 2, false);
            // Process elimination on players[4] so that only one remains.
            await tournamentLogic.processElimination(await players[4].getAddress());

            const [isComplete, winner] = await tournamentLogic.checkTournamentStatus();
            expect(isComplete).to.equal(true);
            expect(winner).to.properAddress;
        });

        it("Should handle blind progression during tournament", async function () {
            // Simulate time passage to trigger blind update.
            await ethers.provider.send("evm_increaseTime", [5 * 60 + 10]);
            await ethers.provider.send("evm_mine", []);

            await tournamentLogic.updateBlinds();

            const tournament = await stateStorage.getTournamentState();
            expect(tournament.smallBlind).to.be.gt(SMALL_BLIND);
            expect(tournament.bigBlind).to.be.gt(BIG_BLIND);
        });

        it("Should correctly determine tournament winner", async function () {
            // Eliminate players[1] to players[4] so only player[0] remains.
            for (let i = 1; i < 5; i++) {
                await stateStorage.updatePlayerState(await players[i].getAddress(), {
                    stack: 0,
                    status: 3, // Eliminated
                    currentBet: 0,
                    position: i,
                    holeCards: [0, 0],
                    lastActionTime: 0
                });
            }
            await stateStorage.updateTournamentStatus(1, 1, false);
            const [isComplete, winner] = await tournamentLogic.checkTournamentStatus();
            expect(isComplete).to.equal(true);
            expect(winner).to.equal(await players[0].getAddress());
        });
    });

    describe("Additional Integration Test Cases", function () {
        it("Should correctly update player state and game basics", async function () {
            await stateStorage.updatePlayerState(await players[0].getAddress(), {
                stack: INITIAL_STACK,
                status: 1,
                currentBet: 0,
                position: 0,
                holeCards: [3, 16],
                lastActionTime: 0
            });
        });
    });
});
