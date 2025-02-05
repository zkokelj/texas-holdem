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

    it("Should correctly evaluate a royal flush", async function () {
        // Royal Flush in hearts: A♥, K♥, Q♥, J♥, T♥
        // Hole cards: A♥ (card index 12) and K♥ (card index 11)
        // Board cards: Q♥ (card index 10), J♥ (card index 9), T♥ (card index 8),
        // plus two non-hearts cards (e.g., 9♦ (card index 20) and 6♣ (card index 30))
        const hole = [12, 11] as [number, number];
        const board = [10, 9, 8, 20, 30] as [number, number, number, number, number];
        const [handRank, handType] = await handEvaluator.evaluateHoldemHand(hole, board);
        // Expect handType to be 10 for a royal flush (straight flush with the highest possible straight)
        expect(handType).to.equal(10);
        console.log("Royal Flush Hand Rank:", handRank);
    });

    it("Should correctly evaluate a straight hand (non-flush)", async function () {
        // Straight (non-flush) hand: 5-6-7-8-9
        // Hole cards: 5♣ (card index 29) and 9♦ (card index 20)
        // Board cards: 6♥ (card index 4), 7♠ (card index 44), 8♦ (card index 19),
        // plus two extra cards that do not contribute to a flush: 4♣ (card index 28) and Q♣ (card index 36)
        const hole = [29, 20] as [number, number];
        const board = [4, 44, 19, 28, 36] as [number, number, number, number, number];
        const [handRank, handType] = await handEvaluator.evaluateHoldemHand(hole, board);
        // Expect handType to be 5 for a straight (non-flush)
        expect(handType).to.equal(5);
        console.log("Straight Hand Rank:", handRank);
    });

    it("Should correctly evaluate a three-of-a-kind hand", async function () {
        // Three-of-a-kind hand: Triple 8's (8♥, 8♦, 8♣)
        // Hole cards: 8♥ (card index 6) and 9♦ (card index 20)
        // Board cards: 8♦ (card index 19) and 8♣ (card index 32) complete the triple,
        // plus two unrelated cards: 2♥ (card index 0) and 3♥ (card index 1) and 4♣ (card index 28)
        // (Only 5 board cards are needed; here we use 19, 32, 0, 28, 1)
        const hole = [6, 20] as [number, number];
        const board = [19, 32, 0, 28, 1] as [number, number, number, number, number];
        const [handRank, handType] = await handEvaluator.evaluateHoldemHand(hole, board);
        // Expect handType to be 4 for three-of-a-kind
        expect(handType).to.equal(4);
        console.log("Three-of-a-Kind Hand Rank:", handRank);
    });

    it("Should correctly evaluate a two pair hand", async function () {
        // Two pair hand: Pair of 2's and pair of 3's
        // Hole cards: 2♥ (card index 0) and 3♥ (card index 1)
        // Board cards: 2♦ (card index 13) and 3♦ (card index 14) form the pairs,
        // plus three unrelated cards: 10♥ (card index 8), 9♦ (card index 20), and K♥ (card index 11)
        const hole = [0, 1] as [number, number];
        const board = [13, 14, 8, 20, 11] as [number, number, number, number, number];
        const [handRank, handType] = await handEvaluator.evaluateHoldemHand(hole, board);
        // Expect handType to be 3 for two pair
        expect(handType).to.equal(3);
        console.log("Two Pair Hand Rank:", handRank);
    });

    it("Should correctly evaluate a one pair hand", async function () {
        // One pair hand: Pair of 2's
        // Hole cards: 2♥ (card index 0) and A♥ (card index 12)
        // Board cards: 2♦ (card index 13) provides the pair,
        // plus three unrelated cards: 9♥ (card index 7), Q♥ (card index 10), and J♦ (card index 22)
        const hole = [0, 12] as [number, number];
        const board = [13, 7, 10, 22, 28] as [number, number, number, number, number];
        const [handRank, handType] = await handEvaluator.evaluateHoldemHand(hole, board);
        // Expect handType to be 2 for one pair
        expect(handType).to.equal(2);
        console.log("One Pair Hand Rank:", handRank);
    });

    it("Should return 0 for tied hands", async function () {
        // Tied hands: Both players share the same best hand from the board (royal flush)
        // Board cards: T♥ (card index 8), J♥ (card index 9), Q♥ (card index 10), K♥ (card index 11), A♥ (card index 12)
        // Player 1 hole: 2♥ (card index 0) and 4♥ (card index 2)
        // Player 2 hole: 3♥ (card index 1) and 5♥ (card index 3)
        const board = [8, 9, 10, 11, 12] as [number, number, number, number, number];
        const hole1 = [0, 2] as [number, number];
        const hole2 = [1, 3] as [number, number];
        const result = await handEvaluator.compareHoldemHands(hole1, hole2, board);
        // Expect a tie => result should be 0
        expect(result).to.equal(0);
    });

    it("Should correctly determine winner when player2 wins", async function () {
        // Compare two hands using a one-pair scenario with different kickers.
        // Board: 6♥ (card index 4), 6♦ (card index 17), 2♣ (card index 26), 3♣ (card index 27), 4♣ (card index 28)
        // If player1 has hole: K♥ (card index 11) and T♥ (card index 8)
        // and player2 has hole: A♥ (card index 12) and 7♥ (card index 5),
        // then player2's higher kicker should win.
        const board = [4, 17, 26, 27, 28] as [number, number, number, number, number];
        const hole1 = [11, 8] as [number, number];
        const hole2 = [12, 5] as [number, number];
        const result = await handEvaluator.compareHoldemHands(hole1, hole2, board);
        // Expect player2 to win => result should be 2
        expect(result).to.equal(2);
    });
});
