// test/Router.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
    StateStorage,
    HandManager,
    HandEvaluator,
    GameLogic,
    TournamentLogic,
    Router
} from "../typechain-types";

// Constants for game state
const INITIAL_STACK = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;

// Constants for actions
const FOLD = 0;
const CHECK = 1;
const CALL = 2;
const RAISE = 3;
// For timer tests
const RAISE_AMOUNT = 50;

describe("Router", function () {
    let stateStorage: StateStorage;
    let handManager: HandManager;
    let handEvaluator: HandEvaluator;
    let gameLogic: GameLogic;
    let tournamentLogic: TournamentLogic;
    let router: Router;
    let owner: SignerWithAddress;
    let admin: SignerWithAddress;
    let timerBackend: SignerWithAddress;
    let alice: SignerWithAddress; // a sample player that we will whitelist
    let bob: SignerWithAddress;   // a sample account that remains non-whitelisted

    beforeEach(async function () {
        [owner, admin, timerBackend, alice, bob] = await ethers.getSigners();

        // Deploy core contracts
        const StateStorageFactory = await ethers.getContractFactory("StateStorage");
        stateStorage = await StateStorageFactory.connect(owner).deploy();

        const HandManagerFactory = await ethers.getContractFactory("HandManager");
        handManager = await HandManagerFactory.connect(owner).deploy(await stateStorage.getAddress());

        const HandEvaluatorFactory = await ethers.getContractFactory("HandEvaluator");
        handEvaluator = await HandEvaluatorFactory.connect(owner).deploy();

        const GameLogicFactory = await ethers.getContractFactory("GameLogic");
        gameLogic = await GameLogicFactory.connect(owner).deploy(
            await stateStorage.getAddress(),
            await handManager.getAddress(),
            await handEvaluator.getAddress()
        );

        const TournamentLogicFactory = await ethers.getContractFactory("TournamentLogic");
        tournamentLogic = await TournamentLogicFactory.connect(owner).deploy(await stateStorage.getAddress());

        // Deploy Router
        const RouterFactory = await ethers.getContractFactory("Router");
        router = await RouterFactory.connect(owner).deploy(
            await stateStorage.getAddress(),
            await gameLogic.getAddress(),
            await tournamentLogic.getAddress(),
            await handManager.getAddress(),
            await handEvaluator.getAddress()
        );

        // Authorize contracts in StateStorage
        await stateStorage.connect(owner).authorizeContract(await owner.getAddress());
        await stateStorage.connect(owner).authorizeContract(await gameLogic.getAddress());
        await stateStorage.connect(owner).authorizeContract(await handManager.getAddress());
        await stateStorage.connect(owner).authorizeContract(await tournamentLogic.getAddress());
        await stateStorage.connect(owner).authorizeContract(await router.getAddress());

        // For testing purposes, add alice to the whitelist.
        await router.connect(owner).whitelistPlayer(await alice.getAddress());

        // Also, authorize timerBackend for timer functions.
        await router.connect(owner).addTimerBackend(await timerBackend.getAddress());

        // Initialize each player's state
        const players = [alice, bob, admin, timerBackend];
        for (let i = 0; i < players.length; i++) {
            const playerAddress = await players[i].getAddress();
            await stateStorage.connect(owner).updatePlayerState(playerAddress, {
                stack: INITIAL_STACK,
                status: 1, // Active
                currentBet: 0,
                position: i,
                holeCards: [0, 0] as [number, number],
                lastActionTime: 0,
                totalContribution: 0  // Add totalContribution field
            });
        }

        // Update player states for testing
        const aliceAddress = await alice.getAddress();
        await stateStorage.connect(owner).updatePlayerState(aliceAddress, {
            stack: INITIAL_STACK,
            status: 1,
            currentBet: 0,
            position: 0,
            holeCards: [0, 0] as [number, number],
            lastActionTime: 0,
            totalContribution: 0  // Add totalContribution field
        });

        const bobAddress = await bob.getAddress();
        await stateStorage.connect(owner).updatePlayerState(bobAddress, {
            stack: INITIAL_STACK - SMALL_BLIND,
            status: 1,
            currentBet: SMALL_BLIND,
            position: 1,
            holeCards: [0, 0] as [number, number],
            lastActionTime: 0,
            totalContribution: SMALL_BLIND  // Add totalContribution field
        });

        const adminAddress = await admin.getAddress();
        await stateStorage.connect(owner).updatePlayerState(adminAddress, {
            stack: INITIAL_STACK - BIG_BLIND,
            status: 1,
            currentBet: BIG_BLIND,
            position: 2,
            holeCards: [0, 0] as [number, number],
            lastActionTime: 0,
            totalContribution: BIG_BLIND  // Add totalContribution field
        });
    });

    describe("Whitelisting and Validity Checks", function () {
        it("Should whitelist a player and return true in isWhitelisted", async function () {
            // alice was whitelisted in beforeEach; check her status.
            expect(await router.isWhitelisted(await alice.getAddress())).to.equal(true);
            // bob was not whitelisted.
            expect(await router.isWhitelisted(await bob.getAddress())).to.equal(false);
        });

        it("Should revert routeGameAction if caller is not whitelisted", async function () {
            // bob is not whitelisted so his call should revert.
            const callData = "0x"; // no extra data needed for a CALL action
            await expect(
                router.connect(bob).routeGameAction(CALL, callData)
            ).to.be.revertedWith("Not whitelisted");
        });
    });

    describe("Routing Game Actions", function () {
        beforeEach(async function () {
            // Set up tournament state before testing game actions
            const tournamentSelector = tournamentLogic.interface.getFunction("startTournament").selector;
            const playerAddresses = [
                await alice.getAddress(),
                await bob.getAddress(),
                await admin.getAddress(),
                await timerBackend.getAddress()
            ];
            const tournamentData = ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [playerAddresses]);
            await router.connect(owner).routeTournamentAction(tournamentSelector, tournamentData);

            // Set up game state
            await stateStorage.connect(owner).updatePlayerState(await alice.getAddress(), {
                stack: 1000,
                status: 1, // Active
                currentBet: 0,
                position: 0,
                holeCards: [0, 0] as [number, number],
                lastActionTime: 0,
                totalContribution: 0
            });

            // Set current turn to Alice
            await stateStorage.connect(owner).updateGameBasics(
                0, // PreFlop
                0, // mainPot
                0, // currentBet
                await alice.getAddress() // currentTurn
            );

            // Initialize player state for testing
            const playerState = {
                stack: 1000,
                status: 1, // Active
                currentBet: 0,
                position: 0,
                holeCards: [0, 0] as [number, number],
                lastActionTime: 0,
                totalContribution: 0
            };

            await stateStorage.connect(owner).updatePlayerState(await alice.getAddress(), playerState);

            // Initialize other player states
            await stateStorage.connect(owner).updatePlayerState(await bob.getAddress(), {
                ...playerState,
                position: 1,
                currentBet: SMALL_BLIND,
                stack: INITIAL_STACK - SMALL_BLIND,
                totalContribution: SMALL_BLIND
            });

            await stateStorage.connect(owner).updatePlayerState(await admin.getAddress(), {
                ...playerState,
                position: 2,
                currentBet: BIG_BLIND,
                stack: INITIAL_STACK - BIG_BLIND,
                totalContribution: BIG_BLIND
            });
        });

        it("Should route a valid game action (FOLD) from a whitelisted player", async function () {
            const callData = "0x";
            await expect(router.connect(alice).routeGameAction(FOLD, callData)).to.not.be.reverted;
        });

        it("Should route a valid game action (RAISE) with correct data", async function () {
            // For a raise, data should be exactly 32 bytes (a uint256).
            const raiseAmount = RAISE_AMOUNT;
            const callData = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [raiseAmount]);
            await expect(router.connect(alice).routeGameAction(RAISE, callData)).to.not.be.reverted;
        });

        it("Should revert routeGameAction with invalid action code", async function () {
            // Pass an invalid action (e.g., 5)
            const callData = "0x";
            await expect(router.connect(alice).routeGameAction(5, callData))
                .to.be.revertedWith("Invalid action");
        });
    });

    describe("Routing Tournament Actions", function () {
        it("Should allow an admin to route a tournament action", async function () {
            const selector = tournamentLogic.interface.getFunction("getCurrentBlindLevel").selector;
            await expect(router.connect(owner).routeTournamentAction(selector, "0x")).to.not.be.reverted;
        });

        it("Should revert routeTournamentAction if called by non-admin", async function () {
            const selector = tournamentLogic.interface.getFunction("getCurrentBlindLevel").selector;
            await expect(router.connect(bob).routeTournamentAction(selector, "0x"))
                .to.be.revertedWith("Only admin");
        });
    });

    describe("Contract Upgrade Functionality", function () {
        it("Should upgrade a contract implementation and return the new address", async function () {
            // For testing, we will "upgrade" the GameLogic contract to a dummy address.
            // (In practice, this would be the address of a new implementation.)
            const dummyAddress = await owner.getAddress(); // using owner's address as a dummy
            await expect(router.connect(owner).upgradeContract(1, dummyAddress)).to.not.be.reverted;
            const impl = await router.getImplementation(1);
            expect(impl).to.equal(dummyAddress);
        });

        it("Should revert upgradeContract if called by non-owner", async function () {
            const dummyAddress = await bob.getAddress();
            await expect(router.connect(bob).upgradeContract(1, dummyAddress))
                .to.be.revertedWith("Only owner");
        });
    });

    describe("Timer Backend Management and Blind Updates", function () {
        beforeEach(async function () {
            // Start tournament with multiple players
            const tournamentSelector = tournamentLogic.interface.getFunction("startTournament").selector;
            const playerAddresses = [
                await alice.getAddress(),
                await bob.getAddress(),
                await admin.getAddress(),
                await timerBackend.getAddress()
            ];
            const tournamentData = ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [playerAddresses]);
            await router.connect(owner).routeTournamentAction(tournamentSelector, tournamentData);

            // Set up game state for Alice
            await stateStorage.connect(owner).updatePlayerState(await alice.getAddress(), {
                stack: 1000,
                status: 1, // Active
                currentBet: 0,
                position: 0,
                holeCards: [0, 0] as [number, number],
                lastActionTime: 0,
                totalContribution: 0
            });

            // Set Alice as current turn
            await stateStorage.connect(owner).updateGameBasics(
                0, // PreFlop
                0, // mainPot
                0, // currentBet
                await alice.getAddress() // currentTurn
            );

            // Initialize player state for testing
            const playerState = {
                stack: 1000,
                status: 1, // Active
                currentBet: 0,
                position: 0,
                holeCards: [0, 0] as [number, number],
                lastActionTime: 0,
                totalContribution: 0
            };

            await stateStorage.connect(owner).updatePlayerState(await alice.getAddress(), playerState);

            // Initialize other player states
            await stateStorage.connect(owner).updatePlayerState(await bob.getAddress(), {
                ...playerState,
                position: 1,
                currentBet: SMALL_BLIND,
                stack: INITIAL_STACK - SMALL_BLIND,
                totalContribution: SMALL_BLIND
            });

            await stateStorage.connect(owner).updatePlayerState(await admin.getAddress(), {
                ...playerState,
                position: 2,
                currentBet: BIG_BLIND,
                stack: INITIAL_STACK - BIG_BLIND,
                totalContribution: BIG_BLIND
            });
        });

        it("Should add and remove a timer backend and enforce only authorized timer can call routeBlindUpdate", async function () {
            // timerBackend was added in beforeEach.
            expect(await router.isAuthorizedTimer(await timerBackend.getAddress())).to.equal(true);

            // Call routeBlindUpdate from timerBackend
            await expect(router.connect(timerBackend).routeBlindUpdate()).to.not.be.reverted;

            // Now remove the timer backend.
            await expect(router.connect(owner).removeTimerBackend(await timerBackend.getAddress())).to.not.be.reverted;
            expect(await router.isAuthorizedTimer(await timerBackend.getAddress())).to.equal(false);

            // Now calling routeBlindUpdate from timerBackend should revert.
            await expect(router.connect(timerBackend).routeBlindUpdate()).to.be.revertedWith("Not authorized timer");
        });

        it("Should route timeout action when called by authorized timer", async function () {
            // For testing, we need to set up a situation where a player times out.
            // We simulate by calling routeTimeoutAction from timerBackend.
            // Since routeTimeoutAction calls GameLogic.handlePlayerTimeout, we assume that the necessary state is set.
            // For the purposes of this test, we simply check that the call does not revert.
            await expect(router.connect(timerBackend).routeTimeoutAction(await alice.getAddress())).to.not.be.reverted;
        });
    });

    describe("Get Implementation", function () {
        it("Should return correct implementation addresses by contract type", async function () {
            const stateStorageImpl = await router.getImplementation(0);
            const gameLogicImpl = await router.getImplementation(1);
            const tournamentLogicImpl = await router.getImplementation(2);
            const handManagerImpl = await router.getImplementation(3);
            const handEvaluatorImpl = await router.getImplementation(4);

            expect(stateStorageImpl).to.equal(await stateStorage.getAddress());
            expect(gameLogicImpl).to.equal(await gameLogic.getAddress());
            expect(tournamentLogicImpl).to.equal(await tournamentLogic.getAddress());
            expect(handManagerImpl).to.equal(await handManager.getAddress());
            expect(handEvaluatorImpl).to.equal(await handEvaluator.getAddress());
        });

        it("Should revert getImplementation for invalid contract type", async function () {
            await expect(router.getImplementation(5)).to.be.revertedWith("Invalid contract type");
        });
    });

    it("Should update player state correctly", async function () {
        const playerState = {
            stack: 1000,
            status: 1, // Active
            currentBet: 0,
            position: 0,
            holeCards: [0, 0] as [number, number],
            lastActionTime: 0,
            totalContribution: 0
        };

        await stateStorage.connect(owner).updatePlayerState(await alice.getAddress(), playerState);

        const savedState = await stateStorage.getPlayer(await alice.getAddress());
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
            lastActionTime: 0,
            totalContribution: 0
        };

        await stateStorage.connect(owner).updatePlayerState(await alice.getAddress(), playerState);

        const playerAtPosition = await stateStorage.getPlayerAtPosition(2);
        expect(playerAtPosition).to.equal(await alice.getAddress());
    });
});
