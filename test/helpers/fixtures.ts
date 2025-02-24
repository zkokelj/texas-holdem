// test/helpers/fixtures.ts
import { ethers } from "hardhat";

export async function deployContractsFixture() {
    const [owner, player1, player2, player3, player4, player5] = await ethers.getSigners();

    // Deploy base contracts
    const StateStorage = await ethers.getContractFactory("StateStorage");
    const stateStorage = await StateStorage.deploy();

    const HandEvaluator = await ethers.getContractFactory("HandEvaluator");
    const handEvaluator = await HandEvaluator.deploy();

    // Deploy dependent contracts
    const HandManager = await ethers.getContractFactory("HandManager");
    const handManager = await HandManager.deploy(await stateStorage.getAddress());

    const TournamentLogic = await ethers.getContractFactory("TournamentLogic");
    const tournamentLogic = await TournamentLogic.deploy(await stateStorage.getAddress());

    const GameLogic = await ethers.getContractFactory("GameLogic");
    const gameLogic = await GameLogic.deploy(
        await stateStorage.getAddress(),
        await handManager.getAddress(),
        await handEvaluator.getAddress()
    );

    const Router = await ethers.getContractFactory("Router");
    const router = await Router.deploy(
        await stateStorage.getAddress(),
        await gameLogic.getAddress(),
        await tournamentLogic.getAddress(),
        await handManager.getAddress(),
        await handEvaluator.getAddress()
    );

    // Authorize contracts
    await stateStorage.authorizeContract(await tournamentLogic.getAddress());
    await stateStorage.authorizeContract(await router.getAddress());
    await stateStorage.authorizeContract(await gameLogic.getAddress());
    await stateStorage.authorizeContract(await handManager.getAddress());

    return {
        stateStorage,
        handEvaluator,
        handManager,
        tournamentLogic,
        gameLogic,
        router,
        owner,
        player1,
        player2,
        player3,
        player4,
        player5
    };
}