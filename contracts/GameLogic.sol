// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import './library.sol';
import './interfaces.sol';
import './HandManager.sol';
import './HandEvaluator.sol';
import 'hardhat/console.sol';

/**
 * @title GameLogic
 * @dev Handles poker game logic including betting rounds and game flow
 */
contract GameLogic is IGameLogic {
    // ==================== STATE VARIABLES ====================
    bool private locked;
    using PokerConstants for uint8;

    IStateStorage private stateStorage;
    HandManager private handManager;
    HandEvaluator private handEvaluator;

    // Constants for player actions
    uint8 private constant FOLD = 0;
    uint8 private constant CHECK = 1;
    uint8 private constant CALL = 2;
    uint8 private constant RAISE = 3;

    // Structs
    struct WinnerInfo {
        address singleWinner;
        address[] tiedWinners;
        bool isTied;
    }

    // ==================== EVENTS ====================
    event PotAwarded(uint256 potIndex, address winner, uint256 amount); // TODO: Ziga - potIndex is not used and is hardcoded to 0
    event PlayerAllIn(address indexed player, uint256 amount);

    // ==================== MODIFIERS ====================
    /**
     * @dev Prevents reentrancy attacks by using a mutex lock
     */
    modifier synchronized() {
        require(!locked, 'Reentrant call');
        locked = true;
        _;
        locked = false;
    }

    // ==================== CONSTRUCTOR ====================
    /**
     * @dev Initializes the GameLogic contract with required dependencies
     * @param _stateStorage Address of the state storage contract
     * @param _handManager Address of the hand manager contract
     * @param _handEvaluator Address of the hand evaluator contract
     */
    constructor(
        address _stateStorage,
        address _handManager,
        address _handEvaluator
    ) {
        stateStorage = IStateStorage(_stateStorage);
        handManager = HandManager(_handManager);
        handEvaluator = HandEvaluator(_handEvaluator);
    }

    // ==================== CORE PUBLIC FUNCTIONS ====================
    /**
     * @dev Processes a player's action in the game
     * @param player The address of the player taking action
     * @param action Action type (0=Fold, 1=Check, 2=Call, 3=Raise)
     * @param amount Bet amount (only used for raises)
     */
    function processAction(
        address player,
        uint8 action,
        uint256 amount
    ) external override synchronized {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        require(player == gameState.currentTurn, 'Not your turn');

        if (action == FOLD) {
            _processFold(player);
        } else if (action == CHECK) {
            _processCheck(player);
        } else if (action == CALL) {
            _processCall(player);
        } else if (action == RAISE) {
            _processRaise(player, amount);
        } else {
            revert('Invalid action');
        }
    }

    /**
     * @dev Handles player timeout from authorized timer
     * @param player The address of the player who timed out
     */
    function handlePlayerTimeout(address player) external override {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.TournamentState memory tournament = stateStorage
            .getTournamentState();

        require(player == gameState.currentTurn, "Not current player's turn");
        require(!tournament.isPaused, 'Game is paused');

        _processFold(player);
        emit PlayerTimedOut(player);
        _updateGameState();
    }

    /**
     * @dev Moves the game to the next betting round
     */
    function nextRound() external override synchronized {
        _nextRound();
    }

    /**
     * @dev Gets the valid actions available for a player
     * @param player The address of the player to check
     * @return Array of boolean values indicating valid actions [fold, check, call, raise]
     */
    function getValidActions(
        address player
    ) external view override returns (bool[] memory) {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory playerState = stateStorage.getPlayer(
            player
        );
        bool[] memory validActions = new bool[](4);

        validActions[FOLD] = true;
        validActions[CHECK] = (gameState.currentBet == 0 ||
            playerState.currentBet == gameState.currentBet);
        validActions[CALL] = (playerState.stack >=
            gameState.currentBet - playerState.currentBet);

        uint256 minRaise = gameState.currentBet * 2;
        validActions[RAISE] = (playerState.stack >= minRaise);

        return validActions;
    }

    // ==================== ACTION PROCESSING FUNCTIONS ====================
    // After each action, we need to update the game state and move to the next player

    /**
     * @dev Processes a fold action for a player
     * @param player The address of the player folding
     */
    function _processFold(address player) private {
        IStateStorage.Player memory playerState = stateStorage.getPlayer(
            player
        );
        IStateStorage.GameState memory gameState = stateStorage.getGameState();

        playerState.status = IStateStorage.PlayerStatus.Folded;

        stateStorage.updatePlayerState(player, playerState);

        uint8 activeCount = _getActivePlayerCount();

        if (activeCount == 1) {
            _awardPotToLastPlayer();
        } else {
            _moveToNextPlayer();
        }
    }

    /**
     * @dev Processes a check action for a player
     * @param player The address of the player checking
     */
    function _processCheck(address player) private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory playerState = stateStorage.getPlayer(
            player
        );

        require(
            gameState.currentBet == 0 ||
                playerState.currentBet == gameState.currentBet,
            'Cannot check'
        );

        stateStorage.setPlayerActedInRound(player, true);
        _moveToNextPlayer();
    }

    /**
     * @dev Processes a call action for a player
     * @param player The address of the player calling
     */
    function _processCall(address player) private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory playerState = stateStorage.getPlayer(
            player
        );

        // callAmount is the amount to call to get to the current bet
        uint256 callAmount = gameState.currentBet - playerState.currentBet;

        // Check if player goes all-in with the check!
        // In case if all-in we set the player status to AllIn, set his current bet and add funds to main pot
        if (callAmount >= playerState.stack) {
            playerState.status = IStateStorage.PlayerStatus.AllIn;
            playerState.currentBet = gameState.currentBet;
            gameState.mainPot += playerState.stack;
            playerState.stack = 0;
            playerState.totalContribution += playerState.stack;
            stateStorage.updatePlayerState(player, playerState);
            stateStorage.updateGameState(gameState);
            stateStorage.setPlayerActedInRound(player, true);
            _moveToNextPlayer();
            return;
        }

        // Now we handle the normal call logic (user has enough chips to call and doesn't go all-in with calling)
        require(playerState.stack >= callAmount, 'Not enough chips');

        playerState.stack -= callAmount;
        playerState.currentBet = gameState.currentBet;
        gameState.mainPot += callAmount;
        playerState.totalContribution += callAmount;
        gameState.lastActionAmount = callAmount;

        stateStorage.updatePlayerState(player, playerState);
        stateStorage.updateGameState(gameState);
        stateStorage.setPlayerActedInRound(player, true);

        _moveToNextPlayer();
    }

    /**
     * @dev Processes a raise action for a player
     * @param player The address of the player raising
     * @param raiseAmount The amount to raise by
     */
    function _processRaise(address player, uint256 raiseAmount) private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory playerState = stateStorage.getPlayer(
            player
        );
        IStateStorage.TournamentState memory tournament = stateStorage
            .getTournamentState();

        require(raiseAmount > 0, 'Raise amount must be positive');

        uint256 toCall = gameState.currentBet > playerState.currentBet
            ? gameState.currentBet - playerState.currentBet
            : 0;

        require(
            raiseAmount <= type(uint256).max - toCall,
            'Raise amount too large'
        ); // prevent overflow

        // total amount is the amount to call + the raise amount
        uint256 totalAmount = toCall + raiseAmount;

        console.log('\tPlayer raising:', player);
        console.log('\ttotalAmount', totalAmount);
        console.log('\tplayerState.stack', playerState.stack);

        // In case player is going all-in with the raise
        // We set player status to AllIn, set his current bet and add funds to main pot
        if (totalAmount == playerState.stack) {
            console.log('\tPlayer going all-in from raise');
            playerState.status = IStateStorage.PlayerStatus.AllIn;
            playerState.currentBet = totalAmount;
            gameState.mainPot += playerState.stack;
            playerState.stack = 0;
            playerState.totalContribution += playerState.stack;
            stateStorage.updatePlayerState(player, playerState);
            stateStorage.updateGameState(gameState);
            stateStorage.setPlayerActedInRound(player, true);
            _moveToNextPlayer();
            return;
        }

        // Now we proceed with the normal raise logic - player is not going all-in
        uint256 minRaiseAmount = gameState.lastRaise > 0
            ? gameState.lastRaise
            : tournament.bigBlind;
        require(raiseAmount >= minRaiseAmount, 'Raise too small');
        require(playerState.stack >= totalAmount, 'Not enough chips');

        playerState.stack -= totalAmount;
        gameState.mainPot += totalAmount;
        playerState.currentBet = gameState.currentBet + raiseAmount;

        gameState.currentBet = playerState.currentBet;
        gameState.lastRaise = raiseAmount;
        gameState.lastActionAmount = totalAmount;
        gameState.lastAggressor = playerState.position;
        playerState.totalContribution += totalAmount;
        stateStorage.setPlayerActedInRound(player, true);

        // Reset the acted status for all other active players (because they have to act again after the raise)
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address otherPlayer = stateStorage.getPlayerAtPosition(i);
            if (otherPlayer != address(0) && otherPlayer != player) {
                IStateStorage.Player memory otherPlayerState = stateStorage
                    .getPlayer(otherPlayer);
                if (
                    otherPlayerState.status == IStateStorage.PlayerStatus.Active
                ) {
                    stateStorage.setPlayerActedInRound(otherPlayer, false);
                }
            }
        }

        stateStorage.updatePlayerState(player, playerState);
        stateStorage.updateGameState(gameState);

        _moveToNextPlayer();
    }

    // ==================== GAME FLOW CONTROL FUNCTIONS ====================
    /**
     * @dev Moves the game to the next betting round
     */
    function _nextRound() private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();

        require(
            gameState.currentRound < IStateStorage.BettingRound.River,
            'Hand complete'
        );

        // Reset the current bet and acted status for all players
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(
                    playerAddr
                );
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    player.currentBet = 0;
                    stateStorage.updatePlayerState(playerAddr, player);
                    stateStorage.setPlayerActedInRound(playerAddr, false);
                }
            }
        }

        gameState.currentBet = 0;
        gameState.lastRaise = 0;

        // Set the current turn to the next active player
        address sbPlayer = stateStorage.getPlayerAtPosition(1);
        if (gameState.currentRound >= IStateStorage.BettingRound.PreFlop) {
            gameState.currentTurn = sbPlayer != address(0)
                ? _getNextActivePlayer(stateStorage.getPlayerAtPosition(0))
                : _getNextActivePlayer(address(0));
        } else {
            gameState.currentTurn = _getNextActivePlayer(address(0));
        }

        // Deal the cards for the new round
        // TODO: Ziga - Review this part of the code
        uint8[] memory newCards;
        if (gameState.currentRound == IStateStorage.BettingRound.PreFlop) {
            newCards = handManager.dealFlop();
            gameState.communityCards[0] = newCards[0];
            gameState.communityCards[1] = newCards[1];
            gameState.communityCards[2] = newCards[2];
            gameState.currentRound = IStateStorage.BettingRound.Flop;
        } else if (gameState.currentRound == IStateStorage.BettingRound.Flop) {
            newCards = handManager.dealTurn();
            gameState.communityCards[3] = newCards[0];
            gameState.currentRound = IStateStorage.BettingRound.Turn;
        } else if (gameState.currentRound == IStateStorage.BettingRound.Turn) {
            newCards = handManager.dealRiver();
            gameState.communityCards[4] = newCards[0];
            gameState.currentRound = IStateStorage.BettingRound.River;
        }

        stateStorage.updateGameState(gameState);
        emit RoundStarted(gameState.currentRound);
    }

    /**
     * @dev Moves the action to the next active player
     */
    function _moveToNextPlayer() private {
        if (_getActivePlayerCount() == 1) {
            _awardPotToLastPlayer();
            return;
        }

        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        bool roundComplete = _isRoundComplete();

        if (roundComplete) {
            if (_shouldShowdown()) {
                _handleShowdown();
            } else {
                _nextRound();
            }
        } else {
            address nextPlayer = _getNextActivePlayer(gameState.currentTurn);
            gameState.currentTurn = nextPlayer;
            stateStorage.updateGameState(gameState);
            emit ActionTimerStarted(
                nextPlayer,
                gameState.actionTimer,
                block.number
            );
        }
    }

    /**
     * @dev Updates the game state and handles round completion
     */
    function _updateGameState() private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();

        if (_isRoundComplete()) {
            if (_shouldShowdown()) {
                _handleShowdown();
            } else {
                emit RoundComplete(gameState.currentRound);
            }
        } else {
            address nextPlayer = _getNextActivePlayer(gameState.currentTurn);
            gameState.currentTurn = nextPlayer;
            stateStorage.updateGameState(gameState);

            emit ActionTimerStarted(
                nextPlayer,
                gameState.actionTimer,
                block.number
            );
        }
    }

    // ==================== CHIP DISTRIBUTION FUNCTIONS ====================

    /**
     * @dev Represents a pot in the poker game
     */
    struct Pot {
        uint256 amount;
        address[] eligiblePlayers;
    }

    /**
     * @dev Distributes chips to winners based on side pot calculations
     * Called at the end of a hand when showdown occurs
     */
    function _distributePots() private {
        // Step 1: Gather all player data relevant for pot distribution
        address[] memory playerAddresses = new address[](
            PokerConstants.MAX_PLAYERS
        );
        uint256[] memory contributions = new uint256[](
            PokerConstants.MAX_PLAYERS
        );
        uint8 playerCount = 0;

        // Collect non-folded players (active or all-in)
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(
                    playerAddr
                );

                if (
                    player.status == IStateStorage.PlayerStatus.Active ||
                    player.status == IStateStorage.PlayerStatus.AllIn
                ) {
                    playerAddresses[playerCount] = playerAddr;
                    contributions[playerCount] = player.totalContribution;
                    playerCount++;
                }
            }
        }

        // Early return if only one player remains (they get the whole pot)
        if (playerCount == 1) {
            IStateStorage.GameState memory gameState = stateStorage
                .getGameState();
            IStateStorage.Player memory winner = stateStorage.getPlayer(
                playerAddresses[0]
            );
            winner.stack += gameState.mainPot;
            stateStorage.updatePlayerState(playerAddresses[0], winner);

            emit PotAwarded(0, playerAddresses[0], gameState.mainPot);
            return;
        }

        // Step 2: Sort contributions in ascending order (simple bubble sort)
        for (uint8 i = 0; i < playerCount - 1; i++) {
            for (uint8 j = 0; j < playerCount - i - 1; j++) {
                if (contributions[j] > contributions[j + 1]) {
                    // Swap contributions
                    uint256 tempContribution = contributions[j];
                    contributions[j] = contributions[j + 1];
                    contributions[j + 1] = tempContribution;

                    // Swap player addresses accordingly
                    address tempPlayer = playerAddresses[j];
                    playerAddresses[j] = playerAddresses[j + 1];
                    playerAddresses[j + 1] = tempPlayer;
                }
            }
        }

        // Step 3: Find unique contribution thresholds (these define our pots)
        uint256[] memory uniqueContributions = new uint256[](playerCount);
        uint8 uniqueCount = 0;

        for (uint8 i = 0; i < playerCount; i++) {
            if (i == 0 || contributions[i] > contributions[i - 1]) {
                uniqueContributions[uniqueCount] = contributions[i];
                uniqueCount++;
            }
        }

        // Step 4: Create pots based on these thresholds
        Pot[] memory pots = new Pot[](uniqueCount);
        uint256 prevThreshold = 0;

        for (uint8 i = 0; i < uniqueCount; i++) {
            uint256 currentThreshold = uniqueContributions[i];

            // Count eligible players for this pot
            uint8 eligibleCount = 0;
            for (uint8 j = 0; j < playerCount; j++) {
                if (contributions[j] >= currentThreshold) {
                    eligibleCount++;
                }
            }

            // Create array of eligible players
            address[] memory eligiblePlayers = new address[](eligibleCount);
            uint8 eligibleIndex = 0;
            uint256 potAmount = 0;

            // Calculate pot amount from non-folded players
            for (uint8 j = 0; j < playerCount; j++) {
                if (contributions[j] >= currentThreshold) {
                    eligiblePlayers[eligibleIndex] = playerAddresses[j];
                    eligibleIndex++;
                    potAmount += (currentThreshold - prevThreshold);
                }
            }

            // Add contributions from folded players to this pot
            for (uint8 j = 0; j < PokerConstants.MAX_PLAYERS; j++) {
                address playerAddr = stateStorage.getPlayerAtPosition(j);
                if (playerAddr != address(0)) {
                    IStateStorage.Player memory player = stateStorage.getPlayer(
                        playerAddr
                    );

                    if (
                        player.status == IStateStorage.PlayerStatus.Folded &&
                        player.totalContribution > prevThreshold
                    ) {
                        uint256 contribution = player.totalContribution >=
                            currentThreshold
                            ? currentThreshold - prevThreshold
                            : player.totalContribution - prevThreshold;

                        potAmount += contribution;
                    }
                }
            }

            pots[i] = Pot({
                amount: potAmount,
                eligiblePlayers: eligiblePlayers
            });

            prevThreshold = currentThreshold;
        }

        // Step 5: Award each pot to the winner(s)
        for (uint8 i = 0; i < uniqueCount; i++) {
            _awardPotToWinners(i, pots[i]);
        }
    }

    /**
     * @dev Awards a pot to the winner(s) with the best hand
     * @param potIndex Index of the pot (0 for main pot, 1+ for side pots)
     * @param pot The pot to award
     */
    function _awardPotToWinners(uint8 potIndex, Pot memory pot) private {
        if (pot.amount == 0 || pot.eligiblePlayers.length == 0) return;

        // If only one eligible player, they win automatically
        if (pot.eligiblePlayers.length == 1) {
            address winner = pot.eligiblePlayers[0];
            IStateStorage.Player memory winnerState = stateStorage.getPlayer(
                winner
            );
            winnerState.stack += pot.amount;
            stateStorage.updatePlayerState(winner, winnerState);

            emit PotAwarded(0, winner, pot.amount);
            return;
        }

        // Multiple eligible players - evaluate hands
        uint32 bestRank = type(uint32).max; // Lower is better in poker hand rankings
        address[] memory winners = new address[](pot.eligiblePlayers.length);
        uint8 winnerCount = 0;

        IStateStorage.GameState memory gameState = stateStorage.getGameState();

        // Find the best hand(s) among eligible players
        for (uint8 i = 0; i < pot.eligiblePlayers.length; i++) {
            address playerAddr = pot.eligiblePlayers[i];
            IStateStorage.Player memory player = stateStorage.getPlayer(
                playerAddr
            );

            (uint32 rank, ) = handEvaluator.evaluateHoldemHand(
                player.holeCards,
                gameState.communityCards
            );

            if (rank < bestRank) {
                // New best hand
                bestRank = rank;
                winnerCount = 1;
                winners[0] = playerAddr;
            } else if (rank == bestRank) {
                // Tie - add this player to winners
                winners[winnerCount] = playerAddr;
                winnerCount++;
            }
        }

        // Award pot to winner(s)
        uint256 amountPerWinner = pot.amount / winnerCount;
        uint256 remainder = pot.amount % winnerCount;

        for (uint8 i = 0; i < winnerCount; i++) {
            address winner = winners[i];
            IStateStorage.Player memory winnerState = stateStorage.getPlayer(
                winner
            );

            // Last winner gets any remainder chips (to handle odd amounts)
            uint256 awardAmount = i == winnerCount - 1
                ? amountPerWinner + remainder
                : amountPerWinner;

            winnerState.stack += awardAmount;
            stateStorage.updatePlayerState(winner, winnerState);

            emit PotAwarded(0, winner, awardAmount);
        }
    }

    /**
     * @dev Awards the pot when only one player remains (everyone else folded)
     */
    function _awardPotToLastPlayer() private {
        uint8 activeCount = _getActivePlayerCount();
        require(activeCount == 1, 'More than one active player');

        // Find the last active player
        address lastPlayer = address(0);
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(
                    playerAddr
                );
                if (
                    player.status == IStateStorage.PlayerStatus.Active ||
                    player.status == IStateStorage.PlayerStatus.AllIn
                ) {
                    lastPlayer = playerAddr;
                    break;
                }
            }
        }

        require(lastPlayer != address(0), 'No last player found');

        // Award the entire pot to the last player
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory winner = stateStorage.getPlayer(lastPlayer);

        winner.stack += gameState.mainPot;
        stateStorage.updatePlayerState(lastPlayer, winner);

        emit PotAwarded(0, lastPlayer, gameState.mainPot);

        _resetGameState();
    }

    // ==================== HELPER FUNCTIONS ====================
    /**
     * @dev Gets the next active player after the current player
     * @param currentPlayer The current player's address
     * @return The address of the next active player
     */
    function _getNextActivePlayer(
        address currentPlayer
    ) private view returns (address) {
        IStateStorage.TournamentState memory tournament = stateStorage
            .getTournamentState();
        uint8 currentPosition = currentPlayer == address(0)
            ? tournament.buttonPosition
            : stateStorage.getPlayer(currentPlayer).position;

        for (uint8 i = 1; i <= PokerConstants.MAX_PLAYERS; i++) {
            uint8 nextPosition = (currentPosition + i) %
                PokerConstants.MAX_PLAYERS;
            address playerAtPosition = stateStorage.getPlayerAtPosition(
                nextPosition
            );

            if (playerAtPosition != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(
                    playerAtPosition
                );
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    return playerAtPosition;
                }
            }
        }

        revert('No active players found');
    }

    /**
     * @dev Gets the count of active players
     * @return The number of active players
     */
    function _getActivePlayerCount() private view returns (uint8) {
        uint8 count = 0;
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddress = stateStorage.getPlayerAtPosition(i);
            if (playerAddress != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(
                    playerAddress
                );
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    count++;
                }
            }
        }
        return count;
    }

    /**
     * @dev Checks if the current betting round is complete
     * @return True if the round is complete, false otherwise
     */
    function _isRoundComplete() private view returns (bool) {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();

        if (gameState.currentRound == IStateStorage.BettingRound.PreFlop) {
            address bbPlayer = stateStorage.getPlayerAtPosition(2);
            if (bbPlayer != address(0)) {
                IStateStorage.Player memory bbPlayerState = stateStorage
                    .getPlayer(bbPlayer);
                if (
                    bbPlayerState.currentBet == gameState.currentBet &&
                    bbPlayerState.status == IStateStorage.PlayerStatus.Active &&
                    !stateStorage.hasPlayerActedInRound(bbPlayer)
                ) {
                    return false;
                }
            }
        }

        uint8 activeCount = 0;
        uint8 actedCount = 0;

        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(
                    playerAddr
                );
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    activeCount++;
                    if (stateStorage.hasPlayerActedInRound(playerAddr)) {
                        actedCount++;
                    }
                }
            }
        }

        return activeCount == actedCount;
    }

    /**
     * @dev Checks if the hand should proceed to showdown
     * @return True if showdown should occur, false otherwise
     */
    function _shouldShowdown() private view returns (bool) {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        return gameState.currentRound == IStateStorage.BettingRound.River;
    }

    /**
     * @dev Called at showdown to distribute pots
     */
    function _handleShowdown() private {
        // Reveal all active players' hands
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(
                    playerAddr
                );
                if (
                    player.status == IStateStorage.PlayerStatus.Active ||
                    player.status == IStateStorage.PlayerStatus.AllIn
                ) {
                    handManager.revealHand(playerAddr);
                }
            }
        }

        // Distribute pots
        _distributePots();

        // Reset for next hand
        _resetGameState();
    }

    /**
     * @dev Resets the game state for a new hand
     */
    function _resetGameState() private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();

        gameState.currentRound = IStateStorage.BettingRound.PreFlop;
        gameState.currentBet = 0;
        gameState.mainPot = 0;
        gameState.lastRaise = 0;
        gameState.currentTurn = _getNextActivePlayer(address(0));

        stateStorage.updateGameState(gameState);

        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddress = stateStorage.getPlayerAtPosition(i);
            if (playerAddress != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(
                    playerAddress
                );
                if (player.currentBet > 0) {
                    player.currentBet = 0;
                    player.totalContribution = 0;
                    stateStorage.updatePlayerState(playerAddress, player);
                }
            }
        }
    }
}
