import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { StateStorage } from "../typechain-types";

describe("StateStorage", function () {
    let stateStorage: StateStorage;
    let owner: SignerWithAddress;
    let authorized: SignerWithAddress;
    let players: SignerWithAddress[];

    const INITIAL_SMALL_BLIND = 25;
    const INITIAL_BIG_BLIND = 50;
    const BLIND_TIMER = 300; // 5 minutes

    beforeEach(async function () {
        [owner, authorized, ...players] = await ethers.getSigners();

        // Deploy StateStorage
        const StateStorage = await ethers.getContractFactory("StateStorage");
        stateStorage = await StateStorage.connect(owner).deploy() as unknown as StateStorage;
    });

    describe("Initial State", function () {
        it("Should initialize with correct initial tournament state", async function () {
            const [
                smallBlind,
                bigBlind,
                blindTimer,
                lastBlindUpdate,
                tableState,
                buttonPosition,
                dealerPosition,
                activePlayerCount,
                startTime,
                isPaused,
                currentBlindLevel
            ] = await stateStorage.getTournamentStateValues();

            expect(smallBlind).to.equal(INITIAL_SMALL_BLIND);
            expect(bigBlind).to.equal(INITIAL_BIG_BLIND);
            expect(blindTimer).to.equal(300); // 5 minutes
            expect(tableState).to.equal(0); // Waiting
            expect(activePlayerCount).to.equal(0);
            expect(isPaused).to.equal(false);
            expect(currentBlindLevel).to.equal(0);
        });

        it("Should initialize with correct initial game state", async function () {
            const gameState = await stateStorage.getGameState();

            expect(gameState.actionTimer).to.equal(30); // 30 seconds
            expect(gameState.currentRound).to.equal(0); // PreFlop
            expect(gameState.mainPot).to.equal(0);
            expect(gameState.currentBet).to.equal(0);
            expect(gameState.lastRaise).to.equal(0);
        });
    });

    describe("Access Control", function () {
        it("Should allow owner to authorize contracts", async function () {
            await expect(stateStorage.connect(owner).authorizeContract(authorized.address))
                .to.emit(stateStorage, "ContractAuthorized")
                .withArgs(authorized.address);
        });

        it("Should allow owner to deauthorize contracts", async function () {
            await stateStorage.connect(owner).authorizeContract(authorized.address);

            await expect(stateStorage.connect(owner).deauthorizeContract(authorized.address))
                .to.emit(stateStorage, "ContractDeauthorized")
                .withArgs(authorized.address);
        });

        it("Should prevent non-owners from authorizing contracts", async function () {
            await expect(stateStorage.connect(authorized).authorizeContract(players[0].address))
                .to.be.revertedWith("Only owner");
        });

        it("Should prevent unauthorized contracts from updating state", async function () {
            await expect(stateStorage.connect(authorized).updateGameState({
                actionTimer: 30,
                communityCards: [0, 0, 0, 0, 0],
                currentRound: 0,
                mainPot: 0,
                currentBet: 0,
                lastRaise: 0,
                minRaise: 0,
                lastAggressor: 0,
                currentTurn: ethers.ZeroAddress,
                handStartTime: 0,
                lastActionAmount: 0
            })).to.be.revertedWith("Not authorized");
        });
    });

    describe("Player State Management", function () {
        beforeEach(async function () {
            // Authorize caller for state updates
            await stateStorage.connect(owner).authorizeContract(authorized.address);
        });

        it("Should update player state correctly", async function () {
            const playerState = {
                stack: 1000,
                status: 1, // Active
                currentBet: 0,
                position: 0,
                holeCards: [0, 0] as [number, number],
                lastActionTime: 0
            };

            await stateStorage.connect(authorized).updatePlayerState(players[0].address, playerState);

            const savedState = await stateStorage.getPlayer(players[0].address);
            expect(savedState.stack).to.equal(1000);
            expect(savedState.status).to.equal(1);
            expect(savedState.position).to.equal(0);
        });

        it("Should maintain player position mapping", async function () {
            const playerState = {
                stack: 1000,
                status: 1,
                currentBet: 0,
                position: 2,
                holeCards: [0, 0] as [number, number],
                lastActionTime: 0
            };

            await stateStorage.connect(authorized).updatePlayerState(players[0].address, playerState);

            const playerAtPosition = await stateStorage.getPlayerAtPosition(2);
            expect(playerAtPosition).to.equal(players[0].address);
        });

        it("Should clear position mapping when player is eliminated", async function () {
            // First set active player
            await stateStorage.connect(authorized).updatePlayerState(players[0].address, {
                stack: 1000,
                status: 1,
                currentBet: 0,
                position: 2,
                holeCards: [0, 0] as [number, number],
                lastActionTime: 0
            });

            // Then eliminate player
            await stateStorage.connect(authorized).updatePlayerState(players[0].address, {
                stack: 0,
                status: 3, // Eliminated
                currentBet: 0,
                position: 2,
                holeCards: [0, 0] as [number, number],
                lastActionTime: 0
            });

            const playerAtPosition = await stateStorage.getPlayerAtPosition(2);
            expect(playerAtPosition).to.equal(ethers.ZeroAddress);
        });
    });

    describe("Tournament State Management", function () {
        beforeEach(async function () {
            await stateStorage.connect(owner).authorizeContract(authorized.address);
        });

        it("Should update tournament status correctly", async function () {
            await stateStorage.connect(authorized).updateTournamentStatus(
                1, // Active
                5, // activePlayerCount
                false // not paused
            );

            const tournamentState = await stateStorage.getTournamentState();
            expect(tournamentState.tableState).to.equal(1); // Active
            expect(tournamentState.activePlayerCount).to.equal(5);
            expect(tournamentState.isPaused).to.equal(false);
            expect(tournamentState.startTime).to.not.equal(0); // Should be set when activating
        });

        it("Should update tournament blinds correctly", async function () {
            await stateStorage.connect(authorized).updateTournamentBlinds(50, 100);

            const tournamentState = await stateStorage.getTournamentState();
            expect(tournamentState.smallBlind).to.equal(50);
            expect(tournamentState.bigBlind).to.equal(100);
        });

        it("Should update tournament positions correctly", async function () {
            await stateStorage.connect(authorized).updateTournamentPositions(2, 2);

            const tournamentState = await stateStorage.getTournamentState();
            expect(tournamentState.buttonPosition).to.equal(2);
            expect(tournamentState.dealerPosition).to.equal(2);
        });
    });

    describe("Game State Management", function () {
        beforeEach(async function () {
            await stateStorage.connect(owner).authorizeContract(authorized.address);
        });

        it("Should update game basics correctly", async function () {
            await stateStorage.connect(authorized).updateGameBasics(
                1, // Flop
                1000, // mainPot
                50, // currentBet
                players[0].address // currentTurn
            );

            const gameState = await stateStorage.getGameState();
            expect(gameState.currentRound).to.equal(1); // Flop
            expect(gameState.mainPot).to.equal(1000);
            expect(gameState.currentBet).to.equal(50);
            expect(gameState.currentTurn).to.equal(players[0].address);
        });

        it("Should update community cards correctly", async function () {
            const cards = [1, 2, 3, 4, 5] as [number, number, number, number, number];
            await stateStorage.connect(authorized).updateGameCards(cards);

            const gameState = await stateStorage.getGameState();
            expect(gameState.communityCards).to.deep.equal(cards);
        });

        it("Should update game timers correctly", async function () {
            const actionTimer = 45;
            const handStartTime = Math.floor(Date.now() / 1000);

            await stateStorage.connect(authorized).updateGameTimers(
                actionTimer,
                handStartTime
            );

            const gameState = await stateStorage.getGameState();
            expect(gameState.actionTimer).to.equal(actionTimer);
            expect(gameState.handStartTime).to.equal(handStartTime);
        });
    });

    describe("Blind Level Management", function () {
        beforeEach(async function () {
            await stateStorage.connect(owner).authorizeContract(authorized.address);
        });

        it("Should add new blind level correctly", async function () {
            // Get the current block timestamp
            const latestBlock = await ethers.provider.getBlock('latest');
            const currentTimestamp = latestBlock!.timestamp;

            const newLevel = {
                smallBlind: 50,
                bigBlind: 100,
                startTime: currentTimestamp + 300 // 5 minutes in future from current block
            };

            await expect(stateStorage.connect(authorized).addBlindLevel(newLevel))
                .to.emit(stateStorage, "BlindLevelAdded")
                .withArgs(1, newLevel.smallBlind, newLevel.bigBlind);

            const currentLevel = await stateStorage.getCurrentBlindLevel();
            expect(currentLevel.smallBlind).to.equal(newLevel.smallBlind);
            expect(currentLevel.bigBlind).to.equal(newLevel.bigBlind);
        });

        it("Should reject blind level with invalid start time", async function () {
            const latestBlock = await ethers.provider.getBlock('latest');
            const currentTimestamp = latestBlock!.timestamp;

            const pastLevel = {
                smallBlind: 50,
                bigBlind: 100,
                startTime: currentTimestamp - 300 // 5 minutes in past from current block
            };

            await expect(stateStorage.connect(authorized).addBlindLevel(pastLevel))
                .to.be.revertedWith("Invalid start time");
        });

        it("Should maintain blind level history", async function () {
            const latestBlock = await ethers.provider.getBlock('latest');
            const currentTimestamp = latestBlock!.timestamp;

            const newLevel = {
                smallBlind: 50,
                bigBlind: 100,
                startTime: currentTimestamp + 300
            };

            await stateStorage.connect(authorized).addBlindLevel(newLevel);

            const history = await stateStorage.getBlindHistory();
            expect(history.length).to.equal(2); // Initial level + new level
            expect(history[1].smallBlind).to.equal(newLevel.smallBlind);
            expect(history[1].bigBlind).to.equal(newLevel.bigBlind);
        });
    });
});