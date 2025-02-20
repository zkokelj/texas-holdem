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
    event SidePotCreated(uint256 potIndex, uint256 amount);
    event PotAwarded(uint256 potIndex, address winner, uint256 amount);
    event PlayerAllIn(address indexed player, uint256 amount);
    event LogDebug(string message);

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

        // If calling would put them all-in we need to handle everything in the _processAllIn function
        // TODO: Ziga - Make sure _processAllIn handles things the same way if triggered from call and from raise!
        if (callAmount >= playerState.stack) {
            _processAllIn(player, playerState.stack);
            return;
        }

        // Now we handle the normal call logic (user has enough chips to call and doesn't go all-in with calling)
        require(playerState.stack >= callAmount, 'Not enough chips');

        playerState.stack -= callAmount;
        playerState.currentBet = gameState.currentBet;
        gameState.mainPot += callAmount;
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

        if (totalAmount == playerState.stack) {
            console.log('\tPlayer going all-in');
            _processAllIn(player, totalAmount);
            return;
        }

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

        // check if any players went all-in with lower amount than the raise amount here and trigger side pots creation
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            if (playerAddr != address(0)) {
                IStateStorage.Player memory otherPlayer = stateStorage
                    .getPlayer(playerAddr);
                // If player is all-in (stack = 0) and bet less than current bet
                if (
                    otherPlayer.stack == 0 &&
                    otherPlayer.currentBet < gameState.currentBet
                ) {
                    _createSidePots(otherPlayer.currentBet); // TODO: Ziga - Make sure this _createSidePots function is correct!
                }
            }
        }

        stateStorage.setPlayerActedInRound(player, true);

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

    /**
     * @dev Processes an all-in action for a player
     * @param player The address of the player going all-in
     * @param amount The amount being bet (entire stack)
     */
    function _processAllIn(address player, uint256 amount) private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory playerState = stateStorage.getPlayer(
            player
        );

        require(
            playerState.status == IStateStorage.PlayerStatus.Active,
            'Player not active'
        );
        require(amount == playerState.stack, 'Must bet entire stack');

        // toCall is the amount to call to get to the current bet
        uint256 toCall = gameState.currentBet > playerState.currentBet
            ? gameState.currentBet - playerState.currentBet
            : 0;

        // if we don't have enough to call, we need to create a side pot
        if (amount < toCall) {
            console.log(
                '\tPlayer going all-in - and side pot needed because they dont have enough to call'
            );
            _createSidePots(playerState.currentBet + amount);
        }

        playerState.stack = 0;
        playerState.currentBet += amount;
        gameState.mainPot += amount;

        stateStorage.setPlayerActedInRound(player, true);

        // If the player's current bet is greater than the game's current bet,
        // update the game's last raise and current bet to reflect the player's bet.
        // Then, reset the acted status for all other active players.
        if (playerState.currentBet > gameState.currentBet) {
            gameState.lastRaise = playerState.currentBet - gameState.currentBet;
            gameState.currentBet = playerState.currentBet;

            for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
                address otherPlayer = stateStorage.getPlayerAtPosition(i);
                if (otherPlayer != address(0) && otherPlayer != player) {
                    IStateStorage.Player memory otherPlayerState = stateStorage
                        .getPlayer(otherPlayer);
                    if (
                        otherPlayerState.status ==
                        IStateStorage.PlayerStatus.Active
                    ) {
                        stateStorage.setPlayerActedInRound(otherPlayer, false);
                    }
                }
            }
        }

        stateStorage.updatePlayerState(player, playerState);
        stateStorage.updateGameState(gameState);

        // emit the event for the player going all-in
        emit PlayerAllIn(player, amount);

        // move to the next player
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

        address sbPlayer = stateStorage.getPlayerAtPosition(1);
        if (gameState.currentRound >= IStateStorage.BettingRound.PreFlop) {
            gameState.currentTurn = sbPlayer != address(0)
                ? _getNextActivePlayer(stateStorage.getPlayerAtPosition(0))
                : _getNextActivePlayer(address(0));
        } else {
            gameState.currentTurn = _getNextActivePlayer(address(0));
        }

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
                _initiateShowdown();
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
                _initiateShowdown();
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

    // ==================== POT MANAGEMENT FUNCTIONS ====================
    /**
     * @dev Creates side pots when a player goes all-in
     * @param allInAmount The amount the all-in player has bet
     */
    function _createSidePots(uint256 allInAmount) private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        uint256 sidePotAmount = 0;
        address allInPlayer = address(0);

        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(
                    playerAddr
                );
                if (player.currentBet == allInAmount && player.stack == 0) {
                    allInPlayer = playerAddr;
                }

                if (
                    player.status == IStateStorage.PlayerStatus.Active &&
                    player.currentBet > allInAmount
                ) {
                    sidePotAmount += (player.currentBet - allInAmount);
                    player.currentBet = allInAmount;
                    stateStorage.updatePlayerState(playerAddr, player);
                }
            }
        }

        if (sidePotAmount > 0) {
            uint256 newPotIndex = stateStorage.sidePotCount();

            for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
                address playerAddr = stateStorage.getPlayerAtPosition(i);
                if (playerAddr != address(0)) {
                    if (
                        playerAddr == allInPlayer ||
                        stateStorage.getPlayer(playerAddr).status ==
                        IStateStorage.PlayerStatus.Active
                    ) {
                        stateStorage.setPotEligibility(
                            newPotIndex,
                            playerAddr,
                            true
                        );
                    }
                }
            }

            stateStorage.createSidePot(newPotIndex, sidePotAmount);
            gameState.mainPot -= sidePotAmount;
            stateStorage.updateGameState(gameState);

            emit SidePotCreated(newPotIndex, sidePotAmount);
        }
    }

    /**
     * @dev Awards all pots (main and side pots) to the winners
     */
    function _awardPots() private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        uint256 totalSidePots = stateStorage.sidePotCount();

        for (uint256 i = 0; i < totalSidePots; i++) {
            (uint256 amount, bool isResolved) = stateStorage.getSidePot(i);
            if (!isResolved) {
                address[] memory winners = _determineWinnersForPot(i);
                _awardPot(i, winners, amount);
                stateStorage.setSidePotResolved(i);
            }
        }

        if (gameState.mainPot > 0) {
            address[] memory winners = _determineWinnersForPot(
                type(uint256).max
            );
            _awardPot(type(uint256).max, winners, gameState.mainPot);
            gameState.mainPot = 0;
            stateStorage.updateGameState(gameState);
        }
    }

    /**
     * @dev Awards a specific pot to the winner(s)
     * @param potIndex The index of the pot to award (type(uint256).max for main pot)
     * @param winners Array of winning player addresses
     * @param amount The amount to award
     */
    function _awardPot(
        uint256 potIndex,
        address[] memory winners,
        uint256 amount
    ) private {
        if (winners.length == 0) return;

        uint256 splitAmount = amount / winners.length;
        uint256 remainder = amount % winners.length;

        for (uint256 i = 0; i < winners.length; i++) {
            IStateStorage.Player memory winnerState = stateStorage.getPlayer(
                winners[i]
            );
            uint256 winnerAmount = splitAmount;

            if (i == 0) {
                winnerAmount += remainder;
            }

            winnerState.stack += winnerAmount;
            stateStorage.updatePlayerState(winners[i], winnerState);
            emit PotAwarded(potIndex, winners[i], winnerAmount);
        }
    }

    /**
     * @dev Awards the pot to the last remaining player
     */
    function _awardPotToLastPlayer() private {
        address lastPlayer;
        uint8 activePlayers = 0;

        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddress = stateStorage.getPlayerAtPosition(i);
            if (playerAddress != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(
                    playerAddress
                );
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    lastPlayer = playerAddress;
                    activePlayers++;
                }
            }
        }

        require(activePlayers == 1, 'More than one player active');

        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory winner = stateStorage.getPlayer(lastPlayer);
        winner.stack += gameState.mainPot;
        stateStorage.updatePlayerState(lastPlayer, winner);

        gameState.mainPot = 0;
        stateStorage.updateGameState(gameState);

        _resetGameState();
        emit RoundComplete(IStateStorage.BettingRound.PreFlop);
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
     * @dev Initiates the showdown process
     */
    function _initiateShowdown() private {
        uint8 activeCount = _getActivePlayerCount();
        require(activeCount > 0, 'No active players for showdown');

        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddress = stateStorage.getPlayerAtPosition(i);
            if (playerAddress != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(
                    playerAddress
                );
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    handManager.revealHand(playerAddress);
                }
            }
        }

        _awardPots();
        _resetGameState();
    }

    /**
     * @dev Determines the winners for a specific pot
     * @param potIndex The index of the pot (type(uint256).max for main pot)
     * @return Array of winning player addresses
     */
    function _determineWinnersForPot(
        uint256 potIndex
    ) private view returns (address[] memory) {
        uint32 bestRank = type(uint32).max;
        uint8 winnerCount = 0;
        address[] memory potentialWinners = new address[](
            PokerConstants.MAX_PLAYERS
        );

        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            bool isEligible = potIndex == type(uint256).max
                ? true
                : stateStorage.isPlayerEligibleForPot(potIndex, playerAddr);

            if (playerAddr != address(0) && isEligible) {
                IStateStorage.Player memory player = stateStorage.getPlayer(
                    playerAddr
                );
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    (uint32 rank, ) = handEvaluator.evaluateHoldemHand(
                        player.holeCards,
                        stateStorage.getGameState().communityCards
                    );

                    if (rank < bestRank) {
                        bestRank = rank;
                        winnerCount = 1;
                        potentialWinners[0] = playerAddr;
                    } else if (rank == bestRank) {
                        potentialWinners[winnerCount] = playerAddr;
                        winnerCount++;
                    }
                }
            }
        }

        address[] memory winners = new address[](winnerCount);
        for (uint8 i = 0; i < winnerCount; i++) {
            winners[i] = potentialWinners[i];
        }

        return winners;
    }

    /**
     * @dev Calculates the total bets from all players
     * @return The sum of all player bets
     */
    function _calculateTotalPlayerBets() private view returns (uint256) {
        uint256 total = 0;
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(
                    playerAddr
                );
                total += player.currentBet;
            }
        }
        return total;
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
                    stateStorage.updatePlayerState(playerAddress, player);
                }
            }
        }
    }
}
