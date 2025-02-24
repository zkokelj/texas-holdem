// scripts/deploy.ts
import { ethers } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);

    // First deployment wave - Contracts without dependencies
    console.log("\n--- Deploying Base Contracts ---");

    // Deploy StateStorage
    const StateStorage = await ethers.getContractFactory("StateStorage");
    const stateStorage = await StateStorage.deploy();
    // Wait for the deployment transaction to be mined
    await stateStorage.waitForDeployment();
    console.log("StateStorage deployed to:", await stateStorage.getAddress());

    // Deploy HandEvaluator
    const HandEvaluator = await ethers.getContractFactory("HandEvaluator");
    const handEvaluator = await HandEvaluator.deploy();
    await handEvaluator.waitForDeployment();
    console.log("HandEvaluator deployed to:", await handEvaluator.getAddress());

    // Second deployment wave - Contracts with single dependency
    console.log("\n--- Deploying Contracts with Dependencies ---");

    // Deploy HandManager
    const HandManager = await ethers.getContractFactory("HandManager");
    const handManager = await HandManager.deploy(await stateStorage.getAddress());
    await handManager.waitForDeployment();
    console.log("HandManager deployed to:", await handManager.getAddress());

    // Deploy TournamentLogic
    const TournamentLogic = await ethers.getContractFactory("TournamentLogic");
    const tournamentLogic = await TournamentLogic.deploy(await stateStorage.getAddress());
    await tournamentLogic.waitForDeployment();
    console.log("TournamentLogic deployed to:", await tournamentLogic.getAddress());

    // Deploy GameLogic
    const GameLogic = await ethers.getContractFactory("GameLogic");
    const gameLogic = await GameLogic.deploy(
        await stateStorage.getAddress(),
        await handManager.getAddress(),
        await handEvaluator.getAddress()
    );
    await gameLogic.waitForDeployment();
    console.log("GameLogic deployed to:", await gameLogic.getAddress());

    // Finally, deploy Router with all dependencies
    const Router = await ethers.getContractFactory("Router");
    const router = await Router.deploy(
        await stateStorage.getAddress(),
        await gameLogic.getAddress(),
        await tournamentLogic.getAddress(),
        await handManager.getAddress(),
        await handEvaluator.getAddress()
    );
    await router.waitForDeployment();
    console.log("Router deployed to:", await router.getAddress());

    // Post-deployment configuration
    console.log("\n--- Configuring Contract Permissions ---");

    // Authorize contracts in StateStorage
    const authorizationTx1 = await stateStorage.authorizeContract(await tournamentLogic.getAddress());
    await authorizationTx1.wait();
    console.log("Authorized TournamentLogic in StateStorage");

    const authorizationTx2 = await stateStorage.authorizeContract(await router.getAddress());
    await authorizationTx2.wait();
    console.log("Authorized Router in StateStorage");

    const authorizationTx3 = await stateStorage.authorizeContract(await gameLogic.getAddress());
    await authorizationTx3.wait();
    console.log("Authorized GameLogic in StateStorage");

    const authorizationTx4 = await stateStorage.authorizeContract(await handManager.getAddress());
    await authorizationTx4.wait();
    console.log("Authorized HandManager in StateStorage");

    // Print all deployed addresses for easy reference
    console.log("\n--- Deployment Summary ---");
    console.log({
        StateStorage: await stateStorage.getAddress(),
        HandEvaluator: await handEvaluator.getAddress(),
        HandManager: await handManager.getAddress(),
        TournamentLogic: await tournamentLogic.getAddress(),
        GameLogic: await gameLogic.getAddress(),
        Router: await router.getAddress()
    });
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });