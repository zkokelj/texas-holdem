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
    });

    describe("Blind Updates", function () {
        beforeEach(async function () {
            const playerAddresses = players.slice(0, 4).map(p => p.address);
            await tournamentLogic.connect(owner).startTournament(playerAddresses);
        });

        it("Should update blinds after time passes", async function () {
            await ethers.provider.send("evm_increaseTime", [300]);
            await ethers.provider.send("evm_mine", []);

            await tournamentLogic.connect(owner).testSimpleBlindUpdate();

            const [values] = await stateStorage.getTournamentStateArray();
            expect(values[0]).to.equal(INITIAL_SMALL_BLIND); // smallBlind
            expect(values[1]).to.equal(INITIAL_BIG_BLIND); // bigBlind
        });
    });

    describe("Player Elimination", function () {
        it("Should process player elimination correctly", async function () {
            const playerAddresses = players.slice(0, 4).map(p => p.address);
            await tournamentLogic.connect(owner).startTournament(playerAddresses);

            // First set player's stack to 0 using proper struct
            const playerState = {
                stack: 0,
                status: 1, // Active
                currentBet: 0,
                position: 0,
                holeCards: [0, 0],
                lastActionTime: 0
            };

            await stateStorage.connect(owner).updatePlayerState(
                playerAddresses[0],
                playerState
            );

            await tournamentLogic.connect(owner).processElimination(playerAddresses[0]);

            const finalState = await stateStorage.getPlayer(playerAddresses[0]);
            expect(finalState.status).to.equal(3); // PlayerStatus.Eliminated

            const [, smallValues] = await stateStorage.getTournamentStateArray();
            expect(smallValues[3]).to.equal(3); // activePlayerCount
        });
    });
});