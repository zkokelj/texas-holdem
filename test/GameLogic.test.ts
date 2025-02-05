import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("GameLogic", function () {
    let gameLogic: any;
    let stateStorage: any;
    let handManager: any;
    let handEvaluator: any;
    let owner: SignerWithAddress;
    let players: SignerWithAddress[];

    // Constants
    const FOLD = 0;
    const CHECK = 1;
    const CALL = 2;
    const RAISE = 3;

    const INITIAL_STACK = 10000;
    const SMALL_BLIND = 25;
    const BIG_BLIND = 50;

    beforeEach(async function () {
        [owner, ...players] = await ethers.getSigners();

        // Deploy StateStorage first and wait
        const StateStorage = await ethers.getContractFactory("StateStorage");
        stateStorage = await (await StateStorage.connect(owner).deploy()).waitForDeployment();

        // Deploy HandManager and wait
        const HandManager = await ethers.getContractFactory("HandManager");
        handManager = await (await HandManager.connect(owner).deploy(stateStorage.getAddress())).waitForDeployment();

        // Deploy HandEvaluator and wait
        const HandEvaluator = await ethers.getContractFactory("HandEvaluator");
        handEvaluator = await (await HandEvaluator.connect(owner).deploy()).waitForDeployment();

        // Deploy GameLogic and wait
        const GameLogic = await ethers.getContractFactory("GameLogic");
        gameLogic = await (await GameLogic.connect(owner).deploy(
            stateStorage.getAddress(),
            handManager.getAddress(),
            handEvaluator.getAddress()
        )).waitForDeployment();

        // Authorize contracts
        await stateStorage.connect(owner).authorizeContract(gameLogic.getAddress());
        await stateStorage.connect(owner).authorizeContract(handManager.getAddress());
        await stateStorage.connect(owner).authorizeContract(owner.address);

        // Setup initial game state
        await setupInitialGameState();
    });

    async function setupInitialGameState() {
        // Initialize players with starting stacks
        for (let i = 0; i < 5; i++) {
            if (i < players.length) {
                let currentBet = 0;
                let stack = INITIAL_STACK;

                // Set BB's current bet
                if (i === 1) { // BB position
                    currentBet = BIG_BLIND;
                    stack = INITIAL_STACK - BIG_BLIND;
                }

                await stateStorage.connect(owner).updatePlayerState(players[i].address, {
                    stack: stack,
                    status: 1, // Active
                    currentBet: currentBet,
                    position: i,
                    holeCards: [0, 0],
                    lastActionTime: 0
                });
            }
        }

        // Set initial game state
        await stateStorage.connect(owner).updateGameBasics(
            0, // PreFlop
            BIG_BLIND, // mainPot (include BB's bet)
            BIG_BLIND, // currentBet
            players[2].address // currentTurn (after BB)
        );
    }

    describe("Action Processing", function () {
        it("Should process a valid fold action", async function () {
            const player = players[2]; // Player after BB
            await gameLogic.connect(player).processAction(player.address, FOLD, 0);

            const playerState = await stateStorage.getPlayer(player.address);
            expect(playerState.status).to.equal(2); // Folded
        });

        it("Should process a valid check action", async function () {
            // First set currentBet to 0 to allow checking
            await stateStorage.connect(owner).updateGameBasics(
                0, // PreFlop
                0, // mainPot
                0, // currentBet
                players[2].address
            );

            await gameLogic.connect(players[2]).processAction(players[2].address, CHECK, 0);

            const gameState = await stateStorage.getGameState();
            expect(gameState.currentTurn).to.not.equal(players[2].address);
        });

        it("Should process a valid call action", async function () {
            const player = players[2];
            const initialStack = (await stateStorage.getPlayer(player.address)).stack;

            await gameLogic.connect(player).processAction(player.address, CALL, 0);

            const finalPlayerState = await stateStorage.getPlayer(player.address);
            expect(finalPlayerState.stack).to.equal(initialStack - BigInt(BIG_BLIND));
            expect(finalPlayerState.currentBet).to.equal(BigInt(BIG_BLIND));
        });

        it("Should process a valid raise action", async function () {
            const player = players[2];
            const raiseAmount = BigInt(BIG_BLIND * 2);

            await gameLogic.connect(player).processAction(player.address, RAISE, raiseAmount);

            const gameState = await stateStorage.getGameState();
            expect(gameState.currentBet).to.equal(BigInt(BIG_BLIND) + raiseAmount);
        });

        it("Should revert on invalid action type", async function () {
            const player = players[2];
            await expect(
                gameLogic.connect(player).processAction(player.address, 5, 0)
            ).to.be.revertedWith("Invalid action");
        });
    });

    describe("Side Pot Management", function () {
        // TODO: ZIGA - Look at this test again.
        // it("Should create side pot when player goes all-in", async function () {
        //     // Reset the game state first
        //     await stateStorage.connect(owner).updateGameBasics(
        //         0, // PreFlop
        //         0, // mainPot
        //         BigInt(BIG_BLIND), // currentBet = 50
        //         players[2].address // currentTurn
        //     );

        //     // Set up short stack player
        //     const shortStackPlayer = players[2];
        //     const shortStack = BigInt(30); // Small stack amount
        //     await stateStorage.connect(owner).updatePlayerState(shortStackPlayer.address, {
        //         stack: shortStack,
        //         status: 1, // Active
        //         currentBet: BigInt(0),
        //         position: 2,
        //         holeCards: [0, 0],
        //         lastActionTime: 0
        //     });

        //     // Process the all-in call - don't pass amount for CALL action
        //     await gameLogic.connect(shortStackPlayer).processAction(
        //         shortStackPlayer.address,
        //         CALL,
        //         0  // Amount should be 0 for CALL actions
        //     );

        //     const sidePotCount = await stateStorage.sidePotCount();
        //     expect(sidePotCount).to.be.gt(0);
        // });
    });

    describe("Timeout Handling", function () {
        it("Should handle player timeout correctly", async function () {
            await gameLogic.handlePlayerTimeout(players[2].address);

            const playerState = await stateStorage.getPlayer(players[2].address);
            expect(playerState.status).to.equal(2); // Folded
        });

        it("Should only allow timeout for current player", async function () {
            await expect(
                gameLogic.handlePlayerTimeout(players[3].address)
            ).to.be.revertedWith("Not current player's turn");
        });
    });

    describe("Valid Actions", function () {
        it("Should return correct valid actions for player", async function () {
            const validActions = await gameLogic.getValidActions(players[2].address);
            expect(validActions).to.have.lengthOf(4);
            expect(validActions[FOLD]).to.be.true;  // Can always fold
        });

        it("Should correctly identify when check is valid", async function () {
            // Set currentBet to 0 to make checking valid
            await stateStorage.connect(owner).updateGameBasics(
                0, // PreFlop
                0, // mainPot
                0, // currentBet
                players[2].address
            );

            const validActions = await gameLogic.getValidActions(players[2].address);
            expect(validActions[CHECK]).to.be.true;
        });

        it("Should correctly identify when check is invalid", async function () {
            // There's already a bet (BIG_BLIND) from initial setup
            const validActions = await gameLogic.getValidActions(players[2].address);
            expect(validActions[CHECK]).to.be.false;
        });
    });

    describe("Next Round Progression", function () {
        // it("Should move to next round when all active players have matched the bet", async function () {
        //     // Log initial game state
        //     const initialGameState = await stateStorage.getGameState();
        //     console.log("Initial game state:", {
        //         currentRound: initialGameState.currentRound,
        //         currentBet: initialGameState.currentBet,
        //         currentTurn: initialGameState.currentTurn,
        //         mainPot: initialGameState.mainPot
        //     });

        //     // Log player positions and states
        //     for (let i = 0; i < 5; i++) {
        //         const player = players[i];
        //         const playerState = await stateStorage.getPlayer(player.address);
        //         console.log(`Player ${i} state:`, {
        //             address: player.address,
        //             position: playerState.position,
        //             stack: playerState.stack,
        //             currentBet: playerState.currentBet,
        //             status: playerState.status
        //         });
        //     }

        //     // UTG acts first
        //     console.log("\nUTG (players[2]) attempting to act...");
        //     const tx = await gameLogic.connect(players[2]).processAction(players[2].address, CALL, 0);
        //     const receipt = await tx.wait();
        //     console.log("Debug events:");
        //     receipt.logs.forEach((log: any) => {
        //         try {
        //             const event = gameLogic.interface.parseLog(log);
        //             if (event?.name === 'Debug') {
        //                 console.log(`${event.args[0]}: ${event.args[1]}`);
        //             }
        //         } catch (e) {
        //             // Skip logs that aren't Debug events
        //         }
        //     });
        //     console.log("UTG action successful");

        //     // Log game state after UTG
        //     const stateAfterUTG = await stateStorage.getGameState();
        //     console.log("Game state after UTG:", {
        //         currentTurn: stateAfterUTG.currentTurn
        //     });

        //     // Then players[3]
        //     console.log("\nplayers[3] attempting to act...");
        //     await gameLogic.connect(players[3]).processAction(players[3].address, CALL, 0);
        //     console.log("players[3] action successful");

        //     // Then players[4]
        //     console.log("\nplayers[4] attempting to act...");
        //     await gameLogic.connect(players[4]).processAction(players[4].address, CALL, 0);
        //     console.log("players[4] action successful");

        //     // Then SB
        //     console.log("\nSB (players[0]) attempting to act...");
        //     const txSB = await gameLogic.connect(players[0]).processAction(players[0].address, CALL, 0);
        //     const receiptSB = await txSB.wait();
        //     console.log("Debug events for SB:");
        //     receiptSB.logs.forEach((log: any) => {
        //         try {
        //             const event = gameLogic.interface.parseLog(log);
        //             if (event?.name === 'Debug') {
        //                 console.log(`${event.args[0]}: ${event.args[1]}`);
        //             }
        //         } catch (e) {
        //             // Skip logs that aren't Debug events
        //         }
        //     });
        //     console.log("SB action successful");

        //     // Log game state after SB
        //     const stateAfterSB = await stateStorage.getGameState();
        //     console.log("Game state after SB:", {
        //         currentTurn: stateAfterSB.currentTurn,
        //         currentBet: stateAfterSB.currentBet,
        //         mainPot: stateAfterSB.mainPot
        //     });

        //     // BB can check
        //     console.log("\nBB (players[1]) attempting to act...");
        //     await gameLogic.connect(players[1]).processAction(players[1].address, CHECK, 0);
        //     console.log("BB action successful");

        //     // Now we can move to next round
        //     console.log("\nAttempting to move to next round...");
        //     await gameLogic.nextRound();

        //     const finalGameState = await stateStorage.getGameState();
        //     console.log("Final game state:", {
        //         currentRound: finalGameState.currentRound,
        //         currentBet: finalGameState.currentBet,
        //         currentTurn: finalGameState.currentTurn
        //     });

        //     expect(finalGameState.currentRound).to.equal(1); // Should be Flop now
        // });

        // TODO: ZIGA - Look at this test again.
        // it("Should progress from preflop to flop when betting completes", async function () {
        //     // At setup:
        //     // Player 0 is Button (dealer)
        //     // Player 1 is Small Blind
        //     // Player 2 is Big Blind
        //     // Player 3 is UTG (Under the Gun) - first to act preflop
        //     // Player 4 is last to act

        //     const gameState = await stateStorage.getGameState();
        //     console.log("Current turn:", gameState.currentTurn);
        //     console.log("Players in positions:");
        //     for (let i = 0; i < 5; i++) {
        //         const addr = await stateStorage.getPlayerAtPosition(i);
        //         console.log(`Position ${i}:`, addr);
        //     }

        //     // Player 3 (UTG) should be first to act
        //     expect(gameState.currentTurn).to.equal(players[3].address);

        //     // UTG calls
        //     await gameLogic.connect(players[3]).processAction(players[3].address, CALL, 0);

        //     // Player 4 calls 
        //     await gameLogic.connect(players[4]).processAction(players[4].address, CALL, 0);

        //     // Button (Player 0) calls
        //     await gameLogic.connect(players[0]).processAction(players[0].address, CALL, 0);

        //     // SB (Player 1) completes
        //     await gameLogic.connect(players[1]).processAction(players[1].address, CALL, 0);

        //     // BB (Player 2) checks (already posted BB)
        //     await gameLogic.connect(players[2]).processAction(players[2].address, CHECK, 0);

        //     // Now we should be able to move to next round
        //     await gameLogic.nextRound();

        //     const newState = await stateStorage.getGameState();
        //     expect(newState.currentRound).to.equal(1); // Flop
        //     expect(newState.currentBet).to.equal(0);
        //     expect(newState.lastRaise).to.equal(0);
        // });
    });
});