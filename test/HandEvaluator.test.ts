// test/HandEvaluator.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";
import { HandEvaluator } from "../typechain-types";

// Fixture to deploy contract before each test
async function deployHandEvaluatorFixture() {
    const HandEvaluator = await ethers.getContractFactory("HandEvaluator");
    const handEvaluator = await HandEvaluator.deploy();
    return { handEvaluator };
}

describe("HandEvaluator New Test Cases", function () {
    let handEvaluator: HandEvaluator;

    beforeEach(async function () {
        ({ handEvaluator } = await deployHandEvaluatorFixture());
    });

    it("Should evaluate a full house correctly", async function () {
        // 5♥ and 5♦ in the hole
        const hole = [3, 16] as [number, number];

        // 5♣, K♥, K♦, 2♥, 3♥ on the board
        const board = [29, 11, 24, 0, 1] as [number, number, number, number, number];

        // Evaluate
        const [fullRank, fullType] = await handEvaluator.evaluateHoldemHand(hole, board);

        // Check that handType indicates "Full House", i.e. 7 in your contract
        expect(fullType).to.equal(7);

        // Optionally, you can log or check the numeric 'fullRank' if you want
        console.log("Hand Rank:", fullRank);
    });

    it("Should distinguish between flush and straight flush", async function () {
        // Flush-only (no consecutive 5)
        const flushHand = [0, 2] as [number, number];          // 2♥, 4♥
        const flushBoard = [4, 7, 9, 10, 12] as [number, number, number, number, number]; // 6♥, 9♥, J♥, Q♥, A♥

        // Straight Flush (2..6 of hearts)
        const sfHand = [0, 1] as [number, number];            // 2♥, 3♥
        const sfBoard = [2, 3, 4, 10, 12] as [number, number, number, number, number];   // 4♥, 5♥, 6♥, Q♥, A♥

        const [flushRank, flushType] = await handEvaluator.evaluateHoldemHand(flushHand, flushBoard);
        const [sfRank, sfType] = await handEvaluator.evaluateHoldemHand(sfHand, sfBoard);

        // '6' means Flush, '9' means Straight Flush (in this contract)
        expect(flushType).to.equal(6);
        expect(sfType).to.equal(9);
    });

    it("Should correctly evaluate a four-of-a-kind", async function () {
        const hand = [3, 16] as [number, number];  // Two of the 5s
        const board = [29, 42, 0, 1, 2] as [number, number, number, number, number];  // Other two 5s and kickers

        const result = await handEvaluator.evaluateHoldemHand(hand, board);
        expect(result.handType).to.equal(8);  // 8 means Four of a Kind
    });

    it("Should use kicker to break a tie in one pair", async function () {
        // Board: 6♥(4), 6♦(17), 2♣(26), 3♣(27), 4♣(28)
        const board = [4, 17, 26, 27, 28] as [number, number, number, number, number];

        // Player 1: A♥(12), 7♥(5)
        const hole1 = [12, 5] as [number, number];

        // Player 2: K♥(11), T♥(8)
        const hole2 = [11, 8] as [number, number];

        // console.log("Player 1 Hole:", hole1);
        // console.log("Player 2 Hole:", hole2);
        // console.log("Board:", board);

        const [rank1, type1] = await handEvaluator.evaluateHoldemHand(hole1, board);
        const [rank2, type2] = await handEvaluator.evaluateHoldemHand(hole2, board);

        // console.log("Player 1 Hand Rank:", rank1);
        // console.log("Player 1 Hand Type:", type1);
        // console.log("Player 2 Hand Rank:", rank2);
        // console.log("Player 2 Hand Type:", type2);

        const result = await handEvaluator.compareHoldemHands(hole1, hole2, board);

        // Player 1 should win => '1'
        expect(result).to.equal(1);
    });

    it("Should correctly evaluate a high card hand", async function () {
        // Hole: A♥(12), K♦(24)
        const hole = [12, 24] as [number, number];

        // Board: T♣(34), 9♣(33), 7♠(44), 4♦(15), 2♣(26)
        const board = [34, 33, 44, 15, 26] as [number, number, number, number, number];

        const [rank, handType] = await handEvaluator.evaluateHoldemHand(hole, board);

        // '1' => High Card
        expect(handType).to.equal(1);

        // console.log("Hand Rank (High Card):", rank);
    });

    it("Should revert if hole cards are duplicates", async function () {
        // Both hole cards = index 3 => "Duplicate hole cards"
        const hole = [3, 3] as [number, number];
        const board = [0, 1, 2, 4, 5] as [number, number, number, number, number];

        await expect(
            handEvaluator.evaluateHoldemHand(hole, board)
        ).to.be.revertedWith("Duplicate hole cards");
    });

    it("Should revert if a community card matches hole card", async function () {
        const hole = [3, 16] as [number, number];
        // Reuse 3 in the board => revert with "Community card matches hole card"
        const board = [3, 1, 2, 4, 5] as [number, number, number, number, number];

        await expect(
            handEvaluator.evaluateHoldemHand(hole, board)
        ).to.be.revertedWith("Community card matches hole card");
    });

    it("Should revert if community cards contain duplicates", async function () {
        const hole = [0, 1] as [number, number];
        // Duplicate board card => 2 repeated
        const board = [2, 2, 3, 4, 5] as [number, number, number, number, number];

        await expect(
            handEvaluator.evaluateHoldemHand(hole, board)
        ).to.be.revertedWith("Duplicate community cards");
    });

    it("Should revert if any card is out of range", async function () {
        // Valid hole card is [0..51], but 99 is invalid
        const hole = [0, 99] as [number, number];
        const board = [1, 2, 3, 4, 5] as [number, number, number, number, number];

        await expect(
            handEvaluator.evaluateHoldemHand(hole, board)
        ).to.be.revertedWith("Invalid hole cards");
    });
});