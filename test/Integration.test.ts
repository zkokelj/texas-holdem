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
        beforeEach(async function () {
            // Log initial state before tournament
            const initialState = await stateStorage.getGameState();
            // console.log("\nBefore Tournament State:", {
            //     currentTurn: initialState.currentTurn,
            //     currentBet: initialState.currentBet,
            //     mainPot: initialState.mainPot,
            //     currentRound: initialState.currentRound
            // });

            // Start tournament first
            const playerAddrs = [];
            for (let i = 0; i < 5; i++) {
                playerAddrs.push(await players[i].getAddress());
            }
            await tournamentLogic.startTournament(playerAddrs);

            // Log state after tournament starts
            const afterTournamentState = await stateStorage.getGameState();
            // console.log("\nAfter Tournament State:", {
            //     currentTurn: afterTournamentState.currentTurn,
            //     currentBet: afterTournamentState.currentBet,
            //     mainPot: afterTournamentState.mainPot,
            //     currentRound: afterTournamentState.currentRound
            // });

            // Set up all players first with unique hole cards
            for (let i = 0; i < 5; i++) {
                await stateStorage.updatePlayerState(await players[i].getAddress(), {
                    stack: INITIAL_STACK,
                    status: 1, // Active
                    currentBet: 0,
                    position: i,
                    holeCards: [i * 2, i * 2 + 1] as [number, number],  // Each player gets unique cards
                    lastActionTime: 0
                });
            }

            // Manually set player[0]'s hole cards to force a winning hand.
            await stateStorage.updatePlayerState(await players[0].getAddress(), {
                stack: INITIAL_STACK,
                status: 1,
                currentBet: 0,
                position: 0,
                holeCards: [51, 38] as [number, number],  // Ace of Spades, King of Clubs
                lastActionTime: 0
            });

            // Set initial game state with players[2] as current turn (UTG - Under The Gun)
            await stateStorage.connect(owner).updateGameBasics(
                0, // PreFlop
                BIG_BLIND + SMALL_BLIND, // mainPot (SB + BB)
                BIG_BLIND, // currentBet
                await players[2].getAddress() // currentTurn - UTG
            );

            // Log final setup state and first expected player
            const setupState = await stateStorage.getGameState();
            // console.log("\nAfter Setup State:", {
            //     currentTurn: setupState.currentTurn,
            //     expectedFirstPlayer: await players[2].getAddress(),
            //     currentBet: setupState.currentBet,
            //     mainPot: setupState.mainPot
            // });

            // Log all player states
            for (let i = 0; i < 5; i++) {
                const player = await stateStorage.getPlayer(await players[i].getAddress());
                // console.log(`Player ${i} State:`, {
                //     address: await players[i].getAddress(),
                //     position: player.position,
                //     currentBet: player.currentBet,
                //     stack: player.stack,
                //     status: player.status
                // });
            }
        });

        it("Should complete a full hand successfully", async function () {
            // Get the actual current turn address
            const gameState = await stateStorage.getGameState();
            const currentTurnAddress = gameState.currentTurn;

            // Find which player index corresponds to the current turn
            let currentPlayerIndex = -1;
            for (let i = 0; i < players.length; i++) {
                if (await players[i].getAddress() === currentTurnAddress) {
                    currentPlayerIndex = i;
                    break;
                }
            }

            // Now make that player act first
            await gameLogic.connect(players[currentPlayerIndex]).processAction(
                await players[currentPlayerIndex].getAddress(),
                CALL,
                0
            );

            // Continue with the rest in order...
        });

        it("Should handle multiple rounds of betting", async function () {
            const raiseAmount = 50;

            // Get the actual current turn address
            const gameState = await stateStorage.getGameState();
            const currentTurnAddress = gameState.currentTurn;

            // Find which player index corresponds to the current turn
            let currentPlayerIndex = -1;
            for (let i = 0; i < players.length; i++) {
                if (await players[i].getAddress() === currentTurnAddress) {
                    currentPlayerIndex = i;
                    break;
                }
            }

            // Now make that player raise
            await gameLogic.connect(players[currentPlayerIndex]).processAction(
                await players[currentPlayerIndex].getAddress(),
                RAISE,
                raiseAmount
            );

            // For the rest of the players, we need to follow the actual game order
            // Get next player and make them call until we complete the round
            let nextPlayerAddress = (await stateStorage.getGameState()).currentTurn;
            while (nextPlayerAddress !== currentTurnAddress) {
                // Find the player index for this address
                for (let i = 0; i < players.length; i++) {
                    if (await players[i].getAddress() === nextPlayerAddress) {
                        await gameLogic.connect(players[i]).processAction(
                            await players[i].getAddress(),
                            CALL,
                            0
                        );
                        break;
                    }
                }
                // Get the next player's address
                nextPlayerAddress = (await stateStorage.getGameState()).currentTurn;
            }

            await gameLogic.nextRound(); // Move to Flop

            // Continue with similar pattern for other rounds...
        });

        it.skip("Should process showdown correctly", async function () {
            // Set up initial bets for all players
            for (let i = 0; i < 5; i++) {
                await stateStorage.updatePlayerState(await players[i].getAddress(), {
                    stack: INITIAL_STACK - 200,  // They've already put 200 in the pot
                    status: 1, // Active
                    currentBet: 0,  // Reset their current bet to 0
                    position: i,
                    holeCards: [i * 2, i * 2 + 1] as [number, number],
                    lastActionTime: 0
                });
            }

            // Set community cards and game state
            await stateStorage.updateGameCards([29, 42, 24, 37, 50]);
            await stateStorage.updateGameBasics(
                3, // River round
                1000, // mainPot
                0,  // currentBet should be 0 for checking
                await players[0].getAddress()
            );

            // Follow the actual turn order
            let nextPlayerAddress = (await stateStorage.getGameState()).currentTurn;
            const firstPlayerAddress = nextPlayerAddress;
            do {
                // Find the player index for this address
                for (let i = 0; i < players.length; i++) {
                    if (await players[i].getAddress() === nextPlayerAddress) {
                        await gameLogic.connect(players[i]).processAction(
                            await players[i].getAddress(),
                            CHECK,
                            0
                        );
                        break;
                    }
                }
                // Get the next player's address
                nextPlayerAddress = (await stateStorage.getGameState()).currentTurn;
            } while (nextPlayerAddress !== firstPlayerAddress && nextPlayerAddress !== ethers.ZeroAddress);

            // After all players check in River, showdown should happen automatically
            const finalGameState = await stateStorage.getGameState();
            const player0State = await stateStorage.getPlayer(await players[0].getAddress());
            expect(finalGameState.mainPot).to.equal(0);
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
            for (let i = 1; i <= 3; i++) {  // Only eliminate players 1-3
                await stateStorage.updatePlayerState(await players[i].getAddress(), {
                    stack: 0,
                    status: 3, // Eliminated
                    currentBet: 0,
                    position: i,
                    holeCards: [0, 0] as [number, number],
                    lastActionTime: 0
                });
            }

            // Set up player[4] with 0 chips but still active
            await stateStorage.updatePlayerState(await players[4].getAddress(), {
                stack: 0,
                status: 1, // Still active
                currentBet: 0,
                position: 4,
                holeCards: [0, 0] as [number, number],
                lastActionTime: 0
            });

            // Update tournament state to reflect 2 active players
            await stateStorage.updateTournamentStatus(1, 2, false);

            // Now process elimination on player[4]
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
            // First set player[0] as our winner with chips
            await stateStorage.updatePlayerState(await players[0].getAddress(), {
                stack: INITIAL_STACK,  // Keep chips for the winner
                status: 1, // Active
                currentBet: 0,
                position: 0,
                holeCards: [0, 0] as [number, number],
                lastActionTime: 0
            });

            // Eliminate players[1] to players[4]
            for (let i = 1; i < 5; i++) {
                // First set them to active with 0 chips
                await stateStorage.updatePlayerState(await players[i].getAddress(), {
                    stack: 0,
                    status: 1, // Start as Active
                    currentBet: 0,
                    position: i,
                    holeCards: [0, 0] as [number, number],
                    lastActionTime: 0
                });

                // Then process their elimination
                await tournamentLogic.processElimination(await players[i].getAddress());
            }

            // Now check tournament status
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
