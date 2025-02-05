// test/Router.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import {
    StateStorage,
    HandManager,
    HandEvaluator,
    GameLogic,
    TournamentLogic,
    Router
} from "../typechain-types";

describe("Router", function () {
    let stateStorage: StateStorage;
    let handManager: HandManager;
    let handEvaluator: HandEvaluator;
    let gameLogic: GameLogic;
    let tournamentLogic: TournamentLogic;
    let router: Router;
    let owner: Signer;
    let admin: Signer;
    let timerBackend: Signer;
    let alice: Signer; // a sample player that we will whitelist
    let bob: Signer;   // a sample account that remains non-whitelisted

    // Constants for actions
    const FOLD = 0;
    const CHECK = 1;
    const CALL = 2;
    const RAISE = 3;
    // For timer tests
    const RAISE_AMOUNT = 50;

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
        await stateStorage.connect(owner).authorizeContract(await gameLogic.getAddress());
        await stateStorage.connect(owner).authorizeContract(await handManager.getAddress());
        await stateStorage.connect(owner).authorizeContract(await tournamentLogic.getAddress());

        // For testing purposes, add alice to the whitelist.
        await router.connect(owner).whitelistPlayer(await alice.getAddress());

        // Also, authorize timerBackend for timer functions.
        await router.connect(owner).addTimerBackend(await timerBackend.getAddress());
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
        it("Should route a valid game action (FOLD) from a whitelisted player", async function () {
            // alice is whitelisted.
            // When she calls routeGameAction with action FOLD, Router calls GameLogic.processAction.
            // For our test, we simply check that the call does not revert.
            const callData = "0x";
            await expect(router.connect(alice).routeGameAction(FOLD, callData)).to.not.be.reverted;
            // (Optionally, you can check state changes in StateStorage if GameLogic.processAction updates player state.)
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
        it("Should add and remove a timer backend and enforce only authorized timer can call routeBlindUpdate", async function () {
            // timerBackend was added in beforeEach.
            expect(await router.isAuthorizedTimer(await timerBackend.getAddress())).to.equal(true);

            // Call routeBlindUpdate from timerBackend.
            // For this test, we need stateStorage's tournament state to be active and not paused.
            // We can simulate this by updating tournament state via StateStorage.
            // (Assume that the deployed TournamentLogic and StateStorage are set to allow an update.)
            // For our test we simply check that the call does not revert.
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
});
