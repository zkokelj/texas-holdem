import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("TournamentLogic", function () {
    let tournamentLogic: any;
    let stateStorage: any;
    let owner: SignerWithAddress;
    let players: SignerWithAddress[];

    const INITIAL_STACK = 10000;
    const INITIAL_SMALL_BLIND = 25;
    const INITIAL_BIG_BLIND = 50;
    const MAX_PLAYERS = 5;
    const MAX_SMALL_BLIND = 10000;

    beforeEach(async function () {
        [owner, ...players] = await ethers.getSigners();

        // Deploy StateStorage first and wait
        const StateStorage = await ethers.getContractFactory("StateStorage");
        stateStorage = await (await StateStorage.connect(owner).deploy()).waitForDeployment();

        // Then deploy TournamentLogic and wait
        const TournamentLogic = await ethers.getContractFactory("TournamentLogic");
        tournamentLogic = await (await TournamentLogic.connect(owner).deploy(stateStorage.getAddress())).waitForDeployment();

        // Authorize both TournamentLogic and owner
        await stateStorage.connect(owner).authorizeContract(tournamentLogic.getAddress());
        await stateStorage.connect(owner).authorizeContract(owner.address);
    });

    describe("Tournament Initialization", function () {
        it("Should start tournament with valid players", async function () {
            const playerAddresses = players.slice(0, 4).map(p => p.address);
            await tournamentLogic.connect(owner).startTournament(playerAddresses);

            const [values, smallValues, isPaused] = await stateStorage.getTournamentStateArray();
            expect(smallValues[0]).to.equal(1); // TableState.Active
            expect(smallValues[3]).to.equal(4); // activePlayerCount
            expect(values[0]).to.equal(INITIAL_SMALL_BLIND); // smallBlind
            expect(values[1]).to.equal(INITIAL_BIG_BLIND); // bigBlind
        });

        it("Should revert with invalid player count", async function () {
            const singlePlayer = [players[0].address];
            await expect(
                tournamentLogic.connect(owner).startTournament(singlePlayer)
            ).to.be.revertedWith("Invalid player count");
        });

        it("Should revert with duplicate players", async function () {
            const duplicatePlayers = [players[0].address, players[0].address];
            await expect(
                tournamentLogic.connect(owner).startTournament(duplicatePlayers)
            ).to.be.revertedWith("Duplicate player");
        });

        it("Should revert with zero address player", async function () {
            const invalidPlayers = [players[0].address, ethers.ZeroAddress];
            await expect(
                tournamentLogic.connect(owner).startTournament(invalidPlayers)
            ).to.be.revertedWith("Invalid player address");
        });

        it("Should initialize players with correct initial stack", async function () {
            const playerAddresses = players.slice(0, 4).map(p => p.address);
            await tournamentLogic.connect(owner).startTournament(playerAddresses);

            for (let i = 0; i < playerAddresses.length; i++) {
                const player = await stateStorage.getPlayer(playerAddresses[i]);
                expect(player.stack).to.equal(INITIAL_STACK);
                expect(player.status).to.equal(1); // Active
                expect(player.position).to.equal(i);
            }
        });
    });

    describe("Tournament Progress", function () {
        beforeEach(async function () {
            const playerAddresses = players.slice(0, 4).map(p => p.address);

            // Start tournament
            await tournamentLogic.connect(owner).startTournament(playerAddresses);

            // Verify initial state
            const [initialValues, initialSmallValues, initialIsPaused] = await stateStorage.getTournamentStateArray();
            // console.log("Initial tournament state:", {
            //     smallBlind: initialValues[0],
            //     bigBlind: initialValues[1],
            //     blindTimer: initialValues[2],
            //     lastBlindUpdate: initialValues[3],
            //     startTime: initialValues[4],
            //     currentBlindLevel: initialValues[5],
            //     tableState: initialSmallValues[0],
            //     buttonPosition: initialSmallValues[1],
            //     dealerPosition: initialSmallValues[2],
            //     activePlayerCount: initialSmallValues[3],
            //     isPaused: initialIsPaused
            // });
        });

        it("Should return correct tournament progress", async function () {
            // Get initial progress
            // console.log("Getting initial progress");
            const initialProgress = await tournamentLogic.getTournamentProgress();
            expect(initialProgress.elapsedTime).to.be.gte(0);
            expect(initialProgress.blindLevel).to.equal(1); // First level
            expect(initialProgress.remainingPlayers).to.equal(4);

            // Increase time by 5 minutes (one blind level)
            await ethers.provider.send("evm_increaseTime", [300]); // 5 minutes
            await ethers.provider.send("evm_mine", []);
            // console.log("Time increased by 5 minutes");

            // Get current block timestamp
            const block = await ethers.provider.getBlock('latest');
            // console.log("Current block timestamp:", block?.timestamp);

            // Get tournament state after time increase
            const [values, smallValues, isPaused] = await stateStorage.getTournamentStateArray();
            // console.log("Tournament state after time increase:", {
            //     smallBlind: values[0],
            //     bigBlind: values[1],
            //     blindTimer: values[2],
            //     lastBlindUpdate: values[3],
            //     startTime: values[4],
            //     currentBlindLevel: values[5],
            //     tableState: smallValues[0],
            //     buttonPosition: smallValues[1],
            //     dealerPosition: smallValues[2],
            //     activePlayerCount: smallValues[3],
            //     isPaused: isPaused
            // });

            const progress = await tournamentLogic.getTournamentProgress();
            //console.log("Final progress:", progress);

            expect(progress.elapsedTime).to.be.closeTo(300, 5);
            expect(progress.blindLevel).to.equal(2); // Level 1 + 1
            expect(progress.remainingPlayers).to.equal(4);
        });

        it("Should calculate correct blind levels", async function () {
            const currentLevel = await tournamentLogic.getCurrentBlindLevel();
            const expectedLevel = await tournamentLogic.getExpectedBlindLevel();
            expect(currentLevel).to.equal(0);
            expect(expectedLevel).to.equal(0);
        });
    });

    describe("Tournament Completion", function () {
        it("Should complete tournament when only one player remains", async function () {
            const playerAddresses = players.slice(0, 4).map(p => p.address);
            await tournamentLogic.connect(owner).startTournament(playerAddresses);

            // Eliminate all but one player
            for (let i = 0; i < 3; i++) {
                // Set player stack to 0
                await stateStorage.connect(owner).updatePlayerState(
                    playerAddresses[i],
                    {
                        stack: 0,
                        status: 1, // Active
                        currentBet: 0,
                        position: i,
                        holeCards: [0, 0],
                        lastActionTime: 0
                    }
                );
                await tournamentLogic.connect(owner).processElimination(playerAddresses[i]);
            }

            // Check tournament status
            const [isComplete, winner] = await tournamentLogic.checkTournamentStatus();
            expect(isComplete).to.be.true;
            expect(winner).to.equal(playerAddresses[3]);
        });

        it("Should emit TournamentCompleted event", async function () {
            const playerAddresses = players.slice(0, 2).map(p => p.address);
            await tournamentLogic.connect(owner).startTournament(playerAddresses);

            // Set first player's stack to 0
            await stateStorage.connect(owner).updatePlayerState(
                playerAddresses[0],
                {
                    stack: 0,
                    status: 1,
                    currentBet: 0,
                    position: 0,
                    holeCards: [0, 0],
                    lastActionTime: 0
                }
            );

            await expect(tournamentLogic.connect(owner).processElimination(playerAddresses[0]))
                .to.emit(tournamentLogic, "TournamentCompleted")
                .withArgs(playerAddresses[1]);
        });
    });

    describe("Blind Management", function () {
        beforeEach(async function () {
            const playerAddresses = players.slice(0, 4).map(p => p.address);
            await tournamentLogic.connect(owner).startTournament(playerAddresses);
        });

        it("Should update blinds correctly after time passes", async function () {
            // Increase time by 5 minutes (one blind level)
            await ethers.provider.send("evm_increaseTime", [300]);
            await ethers.provider.send("evm_mine", []);

            await tournamentLogic.connect(owner).updateBlinds();

            const [values] = await stateStorage.getTournamentStateArray();
            expect(values[0]).to.equal(INITIAL_SMALL_BLIND + 25); // smallBlind + increment
            expect(values[1]).to.equal(INITIAL_BIG_BLIND + 50); // bigBlind + increment
        });

        it("Should double blinds every three levels", async function () {
            // Increase time by 15 minutes (three blind levels)
            await ethers.provider.send("evm_increaseTime", [900]);
            await ethers.provider.send("evm_mine", []);

            await tournamentLogic.connect(owner).updateBlinds();

            const [values] = await stateStorage.getTournamentStateArray();
            const expectedSmallBlind = INITIAL_SMALL_BLIND * 2;
            const expectedBigBlind = INITIAL_BIG_BLIND * 2;
            expect(values[0]).to.equal(expectedSmallBlind);
            expect(values[1]).to.equal(expectedBigBlind);
        });
    });

    describe("Edge Cases and Security", function () {
        it("Should handle tournament start with max players", async function () {
            const maxPlayers = players.slice(0, MAX_PLAYERS);
            await tournamentLogic.connect(owner).startTournament(maxPlayers.map(p => p.address));

            const [values, smallValues] = await stateStorage.getTournamentStateArray();
            expect(smallValues[3]).to.equal(MAX_PLAYERS); // activePlayerCount
        });

        it("Should prevent starting tournament twice", async function () {
            const playerAddresses = players.slice(0, 4).map(p => p.address);
            await tournamentLogic.connect(owner).startTournament(playerAddresses);

            await expect(
                tournamentLogic.connect(owner).startTournament(playerAddresses)
            ).to.be.revertedWith("Tournament already active");
        });

        it("Should handle blind updates at maximum values", async function () {
            const playerAddresses = players.slice(0, 4).map(p => p.address);
            await tournamentLogic.connect(owner).startTournament(playerAddresses);

            // Increase time significantly to force multiple blind levels
            await ethers.provider.send("evm_increaseTime", [3600]); // 1 hour
            await ethers.provider.send("evm_mine", []);

            // Update blinds multiple times
            for (let i = 0; i < 10; i++) {
                await tournamentLogic.connect(owner).updateBlinds();
                // Add a small time increase between updates to avoid timestamp issues
                await ethers.provider.send("evm_increaseTime", [300]); // 5 minutes
                await ethers.provider.send("evm_mine", []);
            }

            const [values] = await stateStorage.getTournamentStateArray();
            expect(values[0]).to.be.lte(MAX_SMALL_BLIND); // Check small blind cap
        });

        it("Should handle player elimination order correctly", async function () {
            const playerAddresses = players.slice(0, 4).map(p => p.address);
            await tournamentLogic.connect(owner).startTournament(playerAddresses);

            // Eliminate players in reverse order
            for (let i = playerAddresses.length - 1; i > 0; i--) {
                await stateStorage.connect(owner).updatePlayerState(
                    playerAddresses[i],
                    {
                        stack: 0,
                        status: 1, // Active
                        currentBet: 0,
                        position: i,
                        holeCards: [0, 0],
                        lastActionTime: 0
                    }
                );
                await tournamentLogic.connect(owner).processElimination(playerAddresses[i]);
            }

            const [isComplete, winner] = await tournamentLogic.checkTournamentStatus();
            expect(isComplete).to.be.true;
            expect(winner).to.equal(playerAddresses[0]);
        });

        it("Should handle tournament pause/resume correctly", async function () {
            const playerAddresses = players.slice(0, 4).map(p => p.address);
            await tournamentLogic.connect(owner).startTournament(playerAddresses);

            // Pause tournament
            await stateStorage.connect(owner).updateTournamentStatus(
                1, // Active
                4, // activePlayerCount
                true // isPaused
            );

            // Try to update blinds while paused
            await expect(
                tournamentLogic.connect(owner).updateBlinds()
            ).to.be.revertedWith("Tournament paused");
        });

        it("Should handle blind level transitions correctly", async function () {
            const playerAddresses = players.slice(0, 4).map(p => p.address);
            await tournamentLogic.connect(owner).startTournament(playerAddresses);

            // Get initial blind level
            const initialLevel = await tournamentLogic.getCurrentBlindLevel();

            // Increase time by exactly one blind level
            await ethers.provider.send("evm_increaseTime", [300]); // 5 minutes
            await ethers.provider.send("evm_mine", []);

            await tournamentLogic.connect(owner).updateBlinds();
            const newLevel = await tournamentLogic.getCurrentBlindLevel();
            expect(newLevel).to.equal(Number(initialLevel) + 1);
        });

        it("Should prevent blind updates too frequently", async function () {
            const playerAddresses = players.slice(0, 4).map(p => p.address);
            await tournamentLogic.connect(owner).startTournament(playerAddresses);

            // Update blinds
            await tournamentLogic.connect(owner).updateBlinds();

            // Try to update again immediately
            const [values] = await stateStorage.getTournamentStateArray();
            const initialSmallBlind = values[0];

            await tournamentLogic.connect(owner).updateBlinds();
            const [newValues] = await stateStorage.getTournamentStateArray();
            expect(newValues[0]).to.equal(initialSmallBlind); // Should not change
        });

        // it("Should handle tournament completion with high blinds", async function () {
        //     const playerAddresses = players.slice(0, 4).map(p => p.address);
        //     await tournamentLogic.connect(owner).startTournament(playerAddresses);

        //     // Set very high blinds relative to stacks
        //     await stateStorage.connect(owner).updateTournamentBlinds(
        //         INITIAL_STACK / 2, // Very high small blind
        //         INITIAL_STACK      // Very high big blind
        //     );

        //     await tournamentLogic.connect(owner).updateBlinds();
        //     const [isComplete] = await tournamentLogic.checkTournamentStatus();
        //     expect(isComplete).to.be.true;
        // });
    });
});