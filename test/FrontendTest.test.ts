// import { expect } from "chai";
// import { ethers } from "hardhat";
// import { Contract } from "ethers";
// import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// /**
//  * Test suite for frontend interactions with poker game smart contract
//  * Tests cover complete game flow with delays and console logs for better visualization
//  */
// describe("Frontend Game Flow", function () {
//     // Contract instances
//     let gameLogic: any;
//     let stateStorage: any;
//     let handManager: any;
//     let handEvaluator: any;
//     let owner: SignerWithAddress;
//     let players: SignerWithAddress[];

//     // Action constants for poker moves
//     const FOLD = 0;     // Player surrenders their hand
//     const CHECK = 1;    // Player passes when no bet to call
//     const CALL = 2;     // Player matches the current bet
//     const RAISE = 3;    // Player increases the current bet

//     // Game configuration constants
//     const INITIAL_STACK = 10000;  // Starting chips for each player
//     const SMALL_BLIND = 25;       // Mandatory small blind bet
//     const BIG_BLIND = 50;         // Mandatory big blind bet

//     // Player position constants for 5-handed poker
//     const BUTTON = 0;    // Dealer position, last to act post-flop
//     const SB = 1;       // Small Blind, posts smaller forced bet
//     const BB = 2;       // Big Blind, posts larger forced bet
//     const UTG = 3;      // Under the Gun, first to act pre-flop
//     const MP = 4;       // Middle Position, acts between UTG and BTN

//     // Helper function to delay execution
//     const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

//     // Helper function to get position name
//     const getPositionName = (pos: number): string => {
//         switch (pos) {
//             case BUTTON: return "BUTTON";
//             case SB: return "SB";
//             case BB: return "BB";
//             case UTG: return "UTG";
//             case MP: return "MP";
//             default: return "Unknown";
//         }
//     };

//     // Helper function to get action name
//     const getActionName = (action: number): string => {
//         switch (action) {
//             case FOLD: return "FOLD";
//             case CHECK: return "CHECK";
//             case CALL: return "CALL";
//             case RAISE: return "RAISE";
//             default: return "Unknown";
//         }
//     };

//     // Helper function to get round name
//     const getRoundName = (round: number): string => {
//         switch (round) {
//             case 0: return "PRE-FLOP";
//             case 1: return "FLOP";
//             case 2: return "TURN";
//             case 3: return "RIVER";
//             default: return "Unknown";
//         }
//     };

//     beforeEach(async function () {
//         // Get signers for testing - first signer is owner, rest are players
//         [owner, ...players] = await ethers.getSigners();

//         // Deploy and set up the contract system
//         const StateStorage = await ethers.getContractFactory("StateStorage");
//         stateStorage = await (await StateStorage.connect(owner).deploy()).waitForDeployment();

//         const HandManager = await ethers.getContractFactory("HandManager");
//         handManager = await (await HandManager.connect(owner).deploy(stateStorage.getAddress())).waitForDeployment();

//         const HandEvaluator = await ethers.getContractFactory("HandEvaluator");
//         handEvaluator = await (await HandEvaluator.connect(owner).deploy()).waitForDeployment();

//         const GameLogic = await ethers.getContractFactory("GameLogic");
//         gameLogic = await (await GameLogic.connect(owner).deploy(
//             stateStorage.getAddress(),
//             handManager.getAddress(),
//             handEvaluator.getAddress()
//         )).waitForDeployment();

//         // Set up contract permissions
//         await stateStorage.connect(owner).authorizeContract(gameLogic.getAddress());
//         await stateStorage.connect(owner).authorizeContract(handManager.getAddress());
//         await stateStorage.connect(owner).authorizeContract(owner.address);

//         // Initialize the game state with players and positions
//         await setupGameState();
//     });

//     /**
//      * Sets up the initial game state for testing
//      */
//     async function setupGameState() {
//         console.log("\n🎮 Setting up initial game state...");

//         // Initialize each player's state
//         for (let i = 0; i < 5; i++) {
//             let currentBet = 0;
//             let stack = INITIAL_STACK;

//             // Deduct and set blind bets for SB and BB positions
//             if (i === SB) {
//                 currentBet = SMALL_BLIND;
//                 stack = INITIAL_STACK - SMALL_BLIND;
//             } else if (i === BB) {
//                 currentBet = BIG_BLIND;
//                 stack = INITIAL_STACK - BIG_BLIND;
//             }

//             // Assign hole cards to each player
//             let holeCards;
//             if (i === BUTTON) {
//                 holeCards = [51, 47]; // Ace of Spades, Ace of Hearts for BUTTON
//                 console.log(`🎲 ${getPositionName(i)} gets Ace of Spades, Ace of Hearts`);
//             } else if (i === UTG) {
//                 holeCards = [40, 41]; // Lower cards for UTG
//                 console.log(`🎲 ${getPositionName(i)} gets lower cards`);
//             } else {
//                 const holeCard1 = 42 + (i * 2);
//                 const holeCard2 = 43 + (i * 2);
//                 holeCards = [holeCard1, holeCard2];
//                 console.log(`🎲 ${getPositionName(i)} gets sequential cards`);
//             }

//             // Update state for each player
//             await stateStorage.connect(owner).updatePlayerState(players[i].address, {
//                 stack: stack,
//                 status: 1,
//                 currentBet: currentBet,
//                 position: i,
//                 holeCards: holeCards,
//                 lastActionTime: 0
//             });
//         }

//         // Initialize the game state for pre-flop round
//         await stateStorage.connect(owner).updateGameBasics(
//             0,
//             BIG_BLIND,
//             BIG_BLIND,
//             players[UTG].address
//         );

//         console.log("✅ Game state initialized successfully\n");
//     }

//     describe("Full Game Flow", function () {
//         // Increase timeout for this test due to delays
//         this.timeout(60000);  // Increased to 60 seconds

//         it("Should complete all betting rounds with delays and logs", async function () {
//             console.log("\n🏁 Starting full game flow test...\n");

//             // Pre-flop round
//             let currentTurn = (await stateStorage.getGameState()).currentTurn;
//             console.log("📍 PRE-FLOP ROUND BEGINS");
//             console.log(`👉 Current turn: ${getPositionName(players.findIndex(p => p.address === currentTurn))}`);

//             // All players call pre-flop
//             for (let pos of [UTG, MP, BUTTON]) {
//                 await gameLogic.connect(players[pos]).processAction(players[pos].address, CALL, 0);
//                 console.log(`🎯 ${getPositionName(pos)} calls`);
//                 currentTurn = (await stateStorage.getGameState()).currentTurn;
//                 console.log(`👉 Next turn: ${getPositionName(players.findIndex(p => p.address === currentTurn))}\n`);
//                 await delay(2000);
//             }

//             // SB completes the call
//             await gameLogic.connect(players[SB]).processAction(players[SB].address, CALL, 0);
//             console.log(`🎯 SB calls`);
//             currentTurn = (await stateStorage.getGameState()).currentTurn;
//             console.log(`👉 Next turn: ${getPositionName(players.findIndex(p => p.address === currentTurn))}\n`);
//             await delay(2000);

//             // BB checks to end pre-flop
//             await gameLogic.connect(players[BB]).processAction(players[BB].address, CHECK, 0);
//             console.log(`🎯 BB checks`);
//             await delay(2000);

//             // Verify flop round started
//             let gameState = await stateStorage.getGameState();
//             console.log("\n📍 FLOP ROUND BEGINS");
//             console.log(`👉 Current turn: ${getPositionName(players.findIndex(p => p.address === gameState.currentTurn))}`);

//             // Flop round - SB raises, others call
//             await gameLogic.connect(players[SB]).processAction(players[SB].address, RAISE, 100);
//             console.log(`🎯 SB raises to 100`);
//             currentTurn = (await stateStorage.getGameState()).currentTurn;
//             console.log(`👉 Next turn: ${getPositionName(players.findIndex(p => p.address === currentTurn))}\n`);
//             await delay(2000);

//             for (let pos of [BB, UTG, MP, BUTTON]) {
//                 await gameLogic.connect(players[pos]).processAction(players[pos].address, CALL, 0);
//                 console.log(`🎯 ${getPositionName(pos)} calls`);
//                 if (pos !== BUTTON) {
//                     currentTurn = (await stateStorage.getGameState()).currentTurn;
//                     console.log(`👉 Next turn: ${getPositionName(players.findIndex(p => p.address === currentTurn))}\n`);
//                 }
//                 await delay(2000);
//             }

//             // Verify turn round started
//             gameState = await stateStorage.getGameState();
//             console.log("\n📍 TURN ROUND BEGINS");
//             console.log(`👉 Current turn: ${getPositionName(players.findIndex(p => p.address === gameState.currentTurn))}`);

//             // Turn round - Players start folding
//             await gameLogic.connect(players[SB]).processAction(players[SB].address, FOLD, 0);
//             console.log(`🎯 SB folds`);
//             currentTurn = (await stateStorage.getGameState()).currentTurn;
//             console.log(`👉 Next turn: ${getPositionName(players.findIndex(p => p.address === currentTurn))}\n`);
//             await delay(2000);

//             await gameLogic.connect(players[BB]).processAction(players[BB].address, FOLD, 0);
//             console.log(`🎯 BB folds`);
//             currentTurn = (await stateStorage.getGameState()).currentTurn;
//             console.log(`👉 Next turn: ${getPositionName(players.findIndex(p => p.address === currentTurn))}\n`);
//             await delay(2000);

//             await gameLogic.connect(players[UTG]).processAction(players[UTG].address, RAISE, 200);
//             console.log(`🎯 UTG raises to 200`);
//             currentTurn = (await stateStorage.getGameState()).currentTurn;
//             console.log(`👉 Next turn: ${getPositionName(players.findIndex(p => p.address === currentTurn))}\n`);
//             await delay(2000);

//             await gameLogic.connect(players[MP]).processAction(players[MP].address, FOLD, 0);
//             console.log(`🎯 MP folds`);
//             currentTurn = (await stateStorage.getGameState()).currentTurn;
//             console.log(`👉 Next turn: ${getPositionName(players.findIndex(p => p.address === currentTurn))}\n`);
//             await delay(2000);

//             await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, CALL, 0);
//             console.log(`🎯 BUTTON calls`);
//             await delay(2000);

//             // Verify river round started
//             gameState = await stateStorage.getGameState();
//             console.log("\n📍 RIVER ROUND BEGINS");
//             console.log(`👉 Current turn: ${getPositionName(players.findIndex(p => p.address === gameState.currentTurn))}`);

//             // River round - Final betting between UTG and BUTTON
//             await gameLogic.connect(players[UTG]).processAction(players[UTG].address, RAISE, 300);
//             console.log(`🎯 UTG raises to 300`);
//             currentTurn = (await stateStorage.getGameState()).currentTurn;
//             console.log(`👉 Next turn: ${getPositionName(players.findIndex(p => p.address === currentTurn))}\n`);
//             await delay(2000);

//             await gameLogic.connect(players[BUTTON]).processAction(players[BUTTON].address, RAISE, 900);
//             console.log(`🎯 BUTTON re-raises to 900`);
//             currentTurn = (await stateStorage.getGameState()).currentTurn;
//             console.log(`👉 Next turn: ${getPositionName(players.findIndex(p => p.address === currentTurn))}\n`);
//             await delay(2000);

//             await gameLogic.connect(players[UTG]).processAction(players[UTG].address, CALL, 0);
//             console.log(`🎯 UTG calls`);
//             await delay(2000);

//             // Verify showdown
//             gameState = await stateStorage.getGameState();
//             console.log("\n🏆 SHOWDOWN");

//             // Get and display final hands
//             const utgHoleCards = await stateStorage.getPlayer(players[UTG].address).then((p: { holeCards: number[] }) => p.holeCards);
//             const buttonHoleCards = await stateStorage.getPlayer(players[BUTTON].address).then((p: { holeCards: number[] }) => p.holeCards);
//             const communityCards = gameState.communityCards;

//             console.log(`UTG's hole cards: [${utgHoleCards.join(", ")}]`);
//             console.log(`BUTTON's hole cards: [${buttonHoleCards.join(", ")}]`);
//             console.log(`Community cards: [${communityCards.join(", ")}]`);

//             // Convert BigInt arrays to regular number arrays
//             const utgHoleCardsNum = utgHoleCards.map((card: bigint): number => Number(card));
//             const buttonHoleCardsNum = buttonHoleCards.map((card: bigint): number => Number(card));
//             const communityCardsNum = communityCards.map((card: bigint): number => Number(card));

//             // Compare hands to determine winner
//             const winner = await handEvaluator.compareHoldemHands(
//                 utgHoleCardsNum,
//                 buttonHoleCardsNum,
//                 communityCardsNum
//             );

//             // Get final stacks
//             const utgFinalStack = await stateStorage.getPlayer(players[UTG].address).then((p: { stack: number }) => p.stack);
//             const buttonFinalStack = await stateStorage.getPlayer(players[BUTTON].address).then((p: { stack: number }) => p.stack);

//             console.log("\n💰 Final Stacks:");
//             console.log(`UTG: ${utgFinalStack}`);
//             console.log(`BUTTON: ${buttonFinalStack}`);

//             // Verify winner
//             if (winner === 1) {
//                 console.log("\n🎉 UTG wins the pot!");
//                 expect(utgFinalStack).to.be.gt(INITIAL_STACK);
//                 expect(buttonFinalStack).to.be.lt(INITIAL_STACK);
//             } else if (winner === 2) {
//                 console.log("\n🎉 BUTTON wins the pot!");
//                 expect(buttonFinalStack).to.be.gt(INITIAL_STACK);
//                 expect(utgFinalStack).to.be.lt(INITIAL_STACK);
//             } else {
//                 console.log("\n🤝 Split pot!");
//                 // TODO: Fix hand evaluation bug
//             }

//             console.log("\n✅ Test completed successfully\n");
//         });
//     });
// });
