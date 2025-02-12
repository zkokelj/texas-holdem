// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "./library.sol";
import "./interfaces.sol";
import "./HandManager.sol";
import "./HandEvaluator.sol";

/**
 * @title GameLogic
 * @dev Handles poker game logic including betting rounds and game flow
 */
contract GameLogic is IGameLogic {
    bool private locked;

    using PokerConstants for uint8;
    
    IStateStorage private stateStorage;
    HandManager private handManager;
    HandEvaluator private handEvaluator;

    struct WinnerInfo {
        address singleWinner;
        address[] tiedWinners;
        bool isTied;
    }
    
    uint8 private constant FOLD = 0;
    uint8 private constant CHECK = 1;
    uint8 private constant CALL = 2;
    uint8 private constant RAISE = 3;

    event SidePotCreated(uint256 potIndex, uint256 amount);
    event PotAwarded(uint256 potIndex, address winner, uint256 amount);
    event PlayerAllIn(address indexed player, uint256 amount);

    modifier synchronized() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }
    
    constructor(
        address _stateStorage,
        address _handManager,
        address _handEvaluator
    ) {
        stateStorage = IStateStorage(_stateStorage);
        handManager = HandManager(_handManager);
        handEvaluator = HandEvaluator(_handEvaluator);
    }
    
    /**
     * @dev Process a player's action in the game
     * @param player The player taking action
     * @param action Action type (0=Fold, 1=Check, 2=Call, 3=Raise)
     * @param amount Bet amount (only used for raises)
     */
    function processAction(
        address player,
        uint8 action,
        uint256 amount
    ) external override synchronized {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        require(player == gameState.currentTurn, "Not your turn");
        
        if (action == FOLD) {
            _processFold(player);
        } else if (action == CHECK) {
            _processCheck(player);
        } else if (action == CALL) {
            _processCall(player);
        } else if (action == RAISE) {
            _processRaise(player, amount);
        } else {
            revert("Invalid action");
        }
    }

    function _processAllIn(address player, uint256 amount) private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory playerState = stateStorage.getPlayer(player);
        
        // Essential validation
        require(playerState.status == IStateStorage.PlayerStatus.Active, "Player not active");
        require(amount == playerState.stack, "Must bet entire stack");
        
        if (amount < gameState.currentBet - playerState.currentBet) {
            // Create side pot only if all-in amount is less than current bet
            _createSidePots(amount + playerState.currentBet);
        }
        
        // Update player state
        playerState.currentBet += amount;
        playerState.stack = 0;
        gameState.mainPot += amount;
        
        stateStorage.updatePlayerState(player, playerState);
        stateStorage.updateGameState(gameState);
        
        emit PlayerAllIn(player, amount);
    }

    function _createSidePots(uint256 allInAmount) private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        uint256 sidePotAmount = 0;
        
        // Calculate side pot from excess bets
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddr);
                if (player.status == IStateStorage.PlayerStatus.Active && 
                    player.currentBet > allInAmount) {
                    sidePotAmount += (player.currentBet - allInAmount);
                    player.currentBet = allInAmount;
                    stateStorage.updatePlayerState(playerAddr, player);
                }
            }
        }
        
        if (sidePotAmount > 0) {
            uint256 newPotIndex = stateStorage.sidePotCount();
            
            // Only track eligibility for active players with remaining stacks
            for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
                address playerAddr = stateStorage.getPlayerAtPosition(i);
                if (playerAddr != address(0)) {
                    IStateStorage.Player memory player = stateStorage.getPlayer(playerAddr);
                    if (player.status == IStateStorage.PlayerStatus.Active && 
                        player.stack > 0) {
                        stateStorage.setPotEligibility(newPotIndex, playerAddr, true);
                    }
                }
            }
            
            stateStorage.createSidePot(newPotIndex, sidePotAmount);
            gameState.mainPot -= sidePotAmount;
            stateStorage.updateGameState(gameState);
            
            emit SidePotCreated(newPotIndex, sidePotAmount);
        }
    }

    function _awardPots() private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        uint256 totalSidePots = stateStorage.sidePotCount();
        
        // Handle side pots
        for (uint256 i = 0; i < totalSidePots; i++) {
            (uint256 amount, bool isResolved) = stateStorage.getSidePot(i);
            if (!isResolved) {
                address[] memory winners = _determineWinnerForPot(i);
                _awardPot(i, winners, amount);
                stateStorage.setSidePotResolved(i);
            }
        }
        
        // Handle main pot
        if (gameState.mainPot > 0) {
            address[] memory winners = _determineWinnerForPot(type(uint256).max);
            _awardPot(type(uint256).max, winners, gameState.mainPot);
            gameState.mainPot = 0;
            stateStorage.updateGameState(gameState);
        }
    }

    function _determineWinnerForPot(uint256 potIndex) private view returns (address[] memory) {
        uint32 bestRank = type(uint32).max;
        uint8 winnerCount = 0;
        address[] memory potentialWinners = new address[](PokerConstants.MAX_PLAYERS);
        
        // Find all players with best hand
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            if (playerAddr != address(0) && stateStorage.isPlayerEligibleForPot(potIndex, playerAddr)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddr);
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
        
        // Return array of winners
        address[] memory winners = new address[](winnerCount);
        for (uint8 i = 0; i < winnerCount; i++) {
            winners[i] = potentialWinners[i];
        }
        
        return winners;
    }

    function _splitPot(uint256 potIndex, address player1, address player2) private {
        (uint256 amount,) = stateStorage.getSidePot(potIndex);
        
        // Create winners array
        address[] memory winners = new address[](2);
        winners[0] = player1;
        winners[1] = player2;
        
        _awardPot(potIndex, winners, amount);
        stateStorage.setSidePotResolved(potIndex);
    }


    function _awardPot(uint256 potIndex, address[] memory winners, uint256 amount) private {
        if (winners.length == 0) return;
        
        uint256 splitAmount = amount / winners.length;
        for (uint256 i = 0; i < winners.length; i++) {
            IStateStorage.Player memory winnerState = stateStorage.getPlayer(winners[i]);
            winnerState.stack += splitAmount;
            stateStorage.updatePlayerState(winners[i], winnerState);
            emit PotAwarded(potIndex, winners[i], splitAmount);
        }
    }

    /**
     * @notice Handle player timeout from authorized timer
     * @param player The player who timed out
     */
    function handlePlayerTimeout(address player) external override {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.TournamentState memory tournament = stateStorage.getTournamentState();
        
        require(player == gameState.currentTurn, "Not current player's turn");
        require(!tournament.isPaused, "Game is paused");
        
        // Process timeout as fold
        _processFold(player);
        emit PlayerTimedOut(player);
        _updateGameState();
    }
    
    /**
     * @dev Move to the next betting round
     */
    // Ensure atomic updates when moving to next round
    function nextRound() external override synchronized {
        _nextRound();
    }

    function _nextRound() private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        
        // Validate state before dealing cards
        require(gameState.currentRound < IStateStorage.BettingRound.River, "Hand complete");
        
        uint8[] memory newCards;
        if (gameState.currentRound == IStateStorage.BettingRound.PreFlop) {
            newCards = handManager.dealFlop();
            gameState.communityCards[0] = newCards[0];
            gameState.communityCards[1] = newCards[1];
            gameState.communityCards[2] = newCards[2];
            gameState.currentRound = IStateStorage.BettingRound.Flop;
        }
        else if (gameState.currentRound == IStateStorage.BettingRound.Flop) {
            newCards = handManager.dealTurn();
            gameState.communityCards[3] = newCards[0];
            gameState.currentRound = IStateStorage.BettingRound.Turn;
        }
        else if (gameState.currentRound == IStateStorage.BettingRound.Turn) {
            newCards = handManager.dealRiver();
            gameState.communityCards[4] = newCards[0];
            gameState.currentRound = IStateStorage.BettingRound.River;
        }
        
        // Reset betting state for new round
        gameState.currentBet = 0;
        gameState.lastRaise = 0;
        gameState.currentTurn = _getNextActivePlayer(address(0));
        
        // Atomic state update
        stateStorage.updateGameState(gameState);
        emit RoundStarted(gameState.currentRound);
    }
    
    /**
     * @dev Get valid actions for a player
     * @param player Player to check
     * @return Array of valid actions [fold, check, call, raise]
     */
    function getValidActions(address player) external view override returns (bool[] memory) {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory playerState = stateStorage.getPlayer(player);
        bool[] memory validActions = new bool[](4);
        
        validActions[FOLD] = true;
        validActions[CHECK] = (gameState.currentBet == 0 || playerState.currentBet == gameState.currentBet);
        validActions[CALL] = (playerState.stack >= gameState.currentBet - playerState.currentBet);
        
        uint256 minRaise = gameState.currentBet * 2;
        validActions[RAISE] = (playerState.stack >= minRaise);
        
        return validActions;
    }
    
    function _processFold(address player) private {
        IStateStorage.Player memory playerState = stateStorage.getPlayer(player);
        playerState.status = IStateStorage.PlayerStatus.Folded;
        stateStorage.updatePlayerState(player, playerState);
        
        if (_getActivePlayerCount() == 1) {
            _awardPotToLastPlayer();
        } else {
            _moveToNextPlayer();
        }
    }
    
    function _processCheck(address player) private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory playerState = stateStorage.getPlayer(player);
        
        require(gameState.currentBet == 0 || playerState.currentBet == gameState.currentBet, 
            "Cannot check");
            
        _moveToNextPlayer();
    }
    
    function _processCall(address player) private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory playerState = stateStorage.getPlayer(player);
        
        uint256 callAmount = gameState.currentBet - playerState.currentBet;
        require(playerState.stack >= callAmount, "Not enough chips");
        
        playerState.stack -= callAmount;
        playerState.currentBet = gameState.currentBet;
        gameState.mainPot += callAmount;
        gameState.lastActionAmount = callAmount;
        
        stateStorage.updatePlayerState(player, playerState);
        stateStorage.updateGameState(gameState);
        
        _moveToNextPlayer();
    }
    
    function _processRaise(address player, uint256 raiseAmount) private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory playerState = stateStorage.getPlayer(player);
        IStateStorage.TournamentState memory tournament = stateStorage.getTournamentState();
        
        // Validate raise amount first
        require(raiseAmount > 0, "Raise amount must be positive");
        
        // Calculate total amount to put in (current bet - already put in + new raise)
        uint256 toCall;
        if (gameState.currentBet > playerState.currentBet) {
            toCall = gameState.currentBet - playerState.currentBet;
        } else {
            toCall = 0;
        }
        
        // Check for overflow in totalAmount calculation
        require(raiseAmount <= type(uint256).max - toCall, "Raise amount too large");
        uint256 totalAmount = toCall + raiseAmount;
        
        // Minimum raise is previous raise amount or BB if no previous raise
        uint256 minRaiseAmount = gameState.lastRaise > 0 ? gameState.lastRaise : tournament.bigBlind;
        require(raiseAmount >= minRaiseAmount, "Raise too small");
        require(playerState.stack >= totalAmount, "Not enough chips");

        if (totalAmount == playerState.stack) {
            _processAllIn(player, totalAmount);
        } else {
            require(playerState.currentBet <= type(uint256).max - totalAmount, "Bet amount overflow");
            
            playerState.stack -= totalAmount;
            playerState.currentBet += totalAmount;
            gameState.mainPot += totalAmount;
            gameState.currentBet = playerState.currentBet;
            gameState.lastRaise = raiseAmount;
            gameState.lastActionAmount = totalAmount;
            gameState.lastAggressor = playerState.position;
            
            stateStorage.updatePlayerState(player, playerState);
            stateStorage.updateGameState(gameState);
            
            _moveToNextPlayer();
        }
    }
    
    function _moveToNextPlayer() private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        
        if (_isRoundComplete()) {
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
    
    function _getNextActivePlayer(address currentPlayer) private view returns (address) {
        IStateStorage.TournamentState memory tournament = stateStorage.getTournamentState();
        uint8 currentPosition = currentPlayer == address(0) ? 
            tournament.buttonPosition : 
            stateStorage.getPlayer(currentPlayer).position;
        
        for (uint8 i = 1; i <= PokerConstants.MAX_PLAYERS; i++) {
            uint8 nextPosition = (currentPosition + i) % PokerConstants.MAX_PLAYERS;
            address playerAtPosition = stateStorage.getPlayerAtPosition(nextPosition);
            
            if (playerAtPosition != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAtPosition);
                if (player.status == IStateStorage.PlayerStatus.Active && player.stack > 0) {
                    return playerAtPosition;
                }
            }
        }
        
        revert("No active players found");
    }
    
    function _getActivePlayerCount() private view returns (uint8) {
        return stateStorage.getTournamentState().activePlayerCount;
    }
    
    function _isRoundComplete() private view returns (bool) {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        
        // Special handling for pre-flop: BB must act
        if (gameState.currentRound == IStateStorage.BettingRound.PreFlop) {
            address bbPlayer = stateStorage.getPlayerAtPosition(2); // BB is at position 2
            if (bbPlayer != address(0)) {
                IStateStorage.Player memory bbPlayerState = stateStorage.getPlayer(bbPlayer);
                // If BB hasn't acted (their bet is still the forced BB amount) and they're not the current turn,
                // the round is not complete
                if (bbPlayerState.currentBet == gameState.currentBet && 
                    bbPlayerState.status == IStateStorage.PlayerStatus.Active &&
                    gameState.currentTurn != bbPlayer) {
                    return false;
                }
            }
        }
        
        uint8 activeCount = 0;
        uint8 matchedCount = 0;
        
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddress = stateStorage.getPlayerAtPosition(i);
            if (playerAddress != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddress);
                if (player.status == IStateStorage.PlayerStatus.Active && player.stack > 0) {
                    activeCount++;
                    if (player.currentBet == gameState.currentBet) {
                        matchedCount++;
                    }
                }
            }
        }
        
        return activeCount == matchedCount;
    }
    
    function _shouldShowdown() private view returns (bool) {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        return gameState.currentRound == IStateStorage.BettingRound.River;
    }
    
    function _initiateShowdown() private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        
        // Get all active players
        address[] memory activePlayers = new address[](_getActivePlayerCount());
        uint8 activeIndex = 0;
        
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddress = stateStorage.getPlayerAtPosition(i);
            if (playerAddress != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddress);
                if (player.status == IStateStorage.PlayerStatus.Active && player.stack > 0) {
                    activePlayers[activeIndex] = playerAddress;
                    activeIndex++;
                    handManager.revealHand(playerAddress);
                }
            }
        }
        
        address winner = _determineWinner(activePlayers);
        _awardPot(winner);
        
        // Reset for next hand
        gameState.currentBet = 0;
        gameState.mainPot = 0;
        gameState.lastRaise = 0;
        stateStorage.updateGameState(gameState);
    }
    
    function _determineWinner(address[] memory activePlayers) private view returns (address) {
        require(activePlayers.length > 0, "No active players");
        
        address bestPlayer = activePlayers[0];
        uint8[2] memory bestHoleCards = stateStorage.getPlayer(bestPlayer).holeCards;
        uint8[5] memory communityCards = stateStorage.getGameState().communityCards;
        (uint32 bestRank, ) = handEvaluator.evaluateHoldemHand(bestHoleCards, communityCards);
        
        for (uint i = 1; i < activePlayers.length; i++) {
            uint8[2] memory currentHoleCards = stateStorage.getPlayer(activePlayers[i]).holeCards;
            (uint32 currentRank, ) = handEvaluator.evaluateHoldemHand(currentHoleCards, communityCards);
            
            if (currentRank < bestRank) {
                bestPlayer = activePlayers[i];
                bestRank = currentRank;
            }
        }
        
        return bestPlayer;
    }
    
    function _awardPot(address winner) private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory winnerState = stateStorage.getPlayer(winner);
        
        winnerState.stack += gameState.mainPot;
        stateStorage.updatePlayerState(winner, winnerState);
        
        gameState.mainPot = 0;
        stateStorage.updateGameState(gameState);
    }
    
    function _awardPotToLastPlayer() private {
        address lastPlayer;
        uint8 activePlayers = 0;
        
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddress = stateStorage.getPlayerAtPosition(i);
            if (playerAddress != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddress);
                if (player.status == IStateStorage.PlayerStatus.Active && player.stack > 0) {
                    lastPlayer = playerAddress;
                    activePlayers++;
                }
            }
        }
        
        require(activePlayers == 1, "More than one player active");
        _awardPot(lastPlayer);
    }
    
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
}
