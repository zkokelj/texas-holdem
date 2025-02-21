import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("HandManager", function () {
    let handManager: any;
    let stateStorage: any;
    let owner: SignerWithAddress;
    let players: SignerWithAddress[];

    const INITIAL_STACK = 10000;
    const SMALL_BLIND = 25;
    const BIG_BLIND = 50;

    beforeEach(async function () {
        [owner, ...players] = await ethers.getSigners();

        // Deploy StateStorage
        const StateStorage = await ethers.getContractFactory("StateStorage");
        stateStorage = await (await StateStorage.connect(owner).deploy()).waitForDeployment();

        // Deploy HandManager
        const HandManager = await ethers.getContractFactory("HandManager");
        handManager = await (await HandManager.connect(owner).deploy(stateStorage.getAddress())).waitForDeployment();

        // Authorize contracts
        await stateStorage.connect(owner).authorizeContract(handManager.getAddress());
        await stateStorage.connect(owner).authorizeContract(owner.address);

        // Setup initial state
        await setupInitialState();
    });

    async function setupInitialState() {
        // Set tournament state
        await stateStorage.connect(owner).updateTournamentStatus(
            1, // TableState.Active
            5, // activePlayerCount
            false // not paused
        );

        // Set button position
        await stateStorage.connect(owner).updateTournamentPositions(
            0, // button
            0  // dealer
        );

        // Set blinds
        await stateStorage.connect(owner).updateTournamentBlinds(
            SMALL_BLIND,
            BIG_BLIND
        );

        // Initialize players
        for (let i = 0; i < 5; i++) {
            await stateStorage.connect(owner).updatePlayerState(players[i].address, {
                stack: INITIAL_STACK,
                status: 1, // Active
                currentBet: 0,
                position: i,
                holeCards: [0, 0] as [number, number],
                lastActionTime: 0,
                totalContribution: 0
            });
        }

        // Update player states for testing
        await stateStorage.connect(owner).updatePlayerState(players[0].address, {
            stack: INITIAL_STACK,
            status: 1,
            currentBet: 0,
            position: 0,
            holeCards: [0, 0] as [number, number],
            lastActionTime: 0,
            totalContribution: 0
        });

        await stateStorage.connect(owner).updatePlayerState(players[1].address, {
            stack: INITIAL_STACK - SMALL_BLIND,
            status: 1,
            currentBet: SMALL_BLIND,
            position: 1,
            holeCards: [0, 0] as [number, number],
            lastActionTime: 0,
            totalContribution: SMALL_BLIND
        });

        await stateStorage.connect(owner).updatePlayerState(players[2].address, {
            stack: INITIAL_STACK - BIG_BLIND,
            status: 1,
            currentBet: BIG_BLIND,
            position: 2,
            holeCards: [0, 0] as [number, number],
            lastActionTime: 0,
            totalContribution: BIG_BLIND
        });
    }

    describe("Initial State", function () {
        it("Should initialize with valid state", async function () {
            // Test state values from testValidateState
            const [smallBlind, bigBlind, buttonPos, activePlayerCount] =
                await handManager.testValidateState();

            expect(smallBlind).to.equal(SMALL_BLIND);
            expect(bigBlind).to.equal(BIG_BLIND);
            expect(buttonPos).to.equal(0);
            expect(activePlayerCount).to.equal(5);
        });

        it("Should revert if tournament not active", async function () {
            // Set tournament to inactive
            await stateStorage.connect(owner).updateTournamentStatus(
                0, // TableState.Waiting
                5,
                false
            );

            await expect(handManager.startNewHand())
                .to.be.revertedWith("Tournament not active");
        });

        it("Should revert if tournament paused", async function () {
            await stateStorage.connect(owner).updateTournamentStatus(
                1, // TableState.Active
                5,
                true // paused
            );

            await expect(handManager.startNewHand())
                .to.be.revertedWith("Game is paused");
        });
    });

    describe("Blind Handling", function () {
        it("Should correctly assign blind positions", async function () {
            const buttonPos = 0;
            // Wait for transaction to be mined and get the return values
            const tx = await handManager.testHandleBlinds(buttonPos, SMALL_BLIND, BIG_BLIND);
            await tx.wait();

            // Get the return values from the transaction result
            const result = await handManager.testHandleBlinds.staticCall(
                buttonPos,
                SMALL_BLIND,
                BIG_BLIND
            );

            const sbPlayer = result.sbPlayer;
            const bbPlayer = result.bbPlayer;

            // Get player at position 1 (SB) and 2 (BB)
            const expectedSB = await stateStorage.getPlayerAtPosition(1);
            const expectedBB = await stateStorage.getPlayerAtPosition(2);

            expect(sbPlayer).to.equal(expectedSB);
            expect(bbPlayer).to.equal(expectedBB);
        });

        it("Should correctly post blinds", async function () {
            await handManager.startNewHand();

            const sbPlayer = await stateStorage.getPlayerAtPosition(1);
            const bbPlayer = await stateStorage.getPlayerAtPosition(2);

            const sbState = await stateStorage.getPlayer(sbPlayer);
            const bbState = await stateStorage.getPlayer(bbPlayer);

            expect(sbState.currentBet).to.equal(SMALL_BLIND);
            expect(bbState.currentBet).to.equal(BIG_BLIND);
            expect(sbState.stack).to.equal(INITIAL_STACK - SMALL_BLIND);
            expect(bbState.stack).to.equal(INITIAL_STACK - BIG_BLIND);
        });

        it("Should revert if players can't post blinds", async function () {
            // Set SB player with insufficient stack
            await stateStorage.connect(owner).updatePlayerState(players[1].address, {
                stack: SMALL_BLIND - 1,
                status: 1,
                currentBet: 0,
                position: 1,
                holeCards: [0, 0] as [number, number],
                lastActionTime: 0,
                totalContribution: 0
            });

            await expect(handManager.startNewHand())
                .to.be.revertedWith("SB cannot post");
        });
    });

    describe("Card Dealing", function () {
        it("Should deal unique hole cards to each player", async function () {
            const dealerSeed = await handManager.startNewHand();
            expect(dealerSeed).to.not.equal(ethers.ZeroHash);

            // Check each player has cards
            const dealtCards = new Set<number>();
            for (let i = 0; i < 5; i++) {
                const player = await stateStorage.getPlayerAtPosition(i);
                const playerState = await stateStorage.getPlayer(player);

                // Verify cards are within valid range
                expect(playerState.holeCards[0]).to.be.lt(52);
                expect(playerState.holeCards[1]).to.be.lt(52);

                // Verify cards are unique
                expect(dealtCards.has(playerState.holeCards[0])).to.be.false;
                expect(dealtCards.has(playerState.holeCards[1])).to.be.false;

                dealtCards.add(playerState.holeCards[0]);
                dealtCards.add(playerState.holeCards[1]);
            }
        });

        it("Should deal flop correctly", async function () {
            await handManager.startNewHand();

            // Get the flop cards using staticCall
            const flopCards = await handManager.dealFlop.staticCall();

            expect(flopCards.length).to.equal(3);
            // Verify cards are unique
            expect(flopCards[0]).to.not.equal(flopCards[1]);
            expect(flopCards[1]).to.not.equal(flopCards[2]);
            expect(flopCards[0]).to.not.equal(flopCards[2]);

            // Execute the actual transaction
            await handManager.dealFlop();
        });

        it("Should deal turn correctly", async function () {
            await handManager.startNewHand();
            await handManager.dealFlop();

            // Update betting round to Flop
            await stateStorage.connect(owner).updateGameBasics(
                1, // BettingRound.Flop
                0, // mainPot
                0, // currentBet
                ethers.ZeroAddress // currentTurn
            );

            const turnCard = await handManager.dealTurn.staticCall();
            expect(turnCard.length).to.equal(1);
            expect(turnCard[0]).to.be.lt(52);

            // Execute the actual transaction
            await handManager.dealTurn();
        });

        it("Should deal river correctly", async function () {
            await handManager.startNewHand();
            await handManager.dealFlop();

            // Update to Flop round
            await stateStorage.connect(owner).updateGameBasics(
                1, // BettingRound.Flop
                0, // mainPot
                0, // currentBet
                ethers.ZeroAddress // currentTurn
            );

            await handManager.dealTurn();

            // Update to Turn round
            await stateStorage.connect(owner).updateGameBasics(
                2, // BettingRound.Turn
                0, // mainPot
                0, // currentBet
                ethers.ZeroAddress // currentTurn
            );

            const riverCard = await handManager.dealRiver.staticCall();
            expect(riverCard.length).to.equal(1);
            expect(riverCard[0]).to.be.lt(52);

            // Execute the actual transaction
            await handManager.dealRiver();
        });

        it("Should revert when dealing out of sequence", async function () {
            await handManager.startNewHand();

            // Try to deal turn before flop
            await expect(handManager.dealTurn())
                .to.be.revertedWith("Not time for turn");

            // Deal flop then try river before turn
            await handManager.dealFlop();
            await expect(handManager.dealRiver())
                .to.be.revertedWith("Not time for river");
        });
    });

    describe("Hand Revelation", function () {
        it("Should allow revealing folded hands", async function () {
            await handManager.startNewHand();

            // Get current player state
            const currentState = await stateStorage.getPlayer(players[0].address);

            // Update player status to folded
            await stateStorage.connect(owner).updatePlayerState(players[0].address, {
                stack: currentState.stack,
                status: 2, // Folded
                currentBet: currentState.currentBet,
                position: currentState.position,
                holeCards: [...currentState.holeCards], // Create a new array
                lastActionTime: currentState.lastActionTime,
                totalContribution: currentState.totalContribution
            });

            await expect(handManager.revealHand(players[0].address))
                .to.emit(handManager, "HandRevealed")
                .withArgs(players[0].address, currentState.holeCards);
        });

        it("Should not allow revealing active hands mid-game", async function () {
            await handManager.startNewHand();

            await expect(handManager.revealHand(players[0].address))
                .to.be.revertedWith("Can only reveal folded hands or during showdown");
        });
    });
});