// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "./library.sol";
import "./interfaces.sol";
import "./HandManager.sol";
import "./HandEvaluator.sol";
import "hardhat/console.sol";

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
    event LogDebug(string message);

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
        
        uint256 callAmount = gameState.currentBet > playerState.currentBet ? 
            gameState.currentBet - playerState.currentBet : 0;
            
        // If all-in is less than current bet, create side pots
        if (amount < callAmount) {
            _createSidePots(playerState.currentBet + amount);
        }
        
        // Update player state
        playerState.stack = 0;
        playerState.currentBet += amount;
        gameState.mainPot += amount;
        
        // Mark player as having acted
        stateStorage.setPlayerActedInRound(player, true);
        
        // If all-in is a raise, reset action for others
        if (playerState.currentBet > gameState.currentBet) {
            gameState.currentBet = playerState.currentBet;
            gameState.lastRaise = playerState.currentBet - gameState.currentBet;
            
            // Reset other players' action flags 
            for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
                address otherPlayer = stateStorage.getPlayerAtPosition(i);
                if (otherPlayer != address(0) && otherPlayer != player) {
                    IStateStorage.Player memory otherPlayerState = stateStorage.getPlayer(otherPlayer);
                    if (otherPlayerState.status == IStateStorage.PlayerStatus.Active) {
                        stateStorage.setPlayerActedInRound(otherPlayer, false);
                    }
                }
            }
        }
        
        stateStorage.updatePlayerState(player, playerState);
        stateStorage.updateGameState(gameState);
        
        emit PlayerAllIn(player, amount);
    }

    function _createSidePots(uint256 allInAmount) private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        uint256 sidePotAmount = 0;
        address allInPlayer = address(0);
        
        // Calculate side pot from excess bets
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddr);
                // Track the player who went all-in
                if (player.currentBet == allInAmount && player.stack == 0) {
                    allInPlayer = playerAddr;
                }
                
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
            
            // Set eligibility for all active players and the all-in player
            for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
                address playerAddr = stateStorage.getPlayerAtPosition(i);
                if (playerAddr != address(0)) {
                    IStateStorage.Player memory player = stateStorage.getPlayer(playerAddr);
                    // All-in player is eligible for their pot
                    if (playerAddr == allInPlayer) {
                        stateStorage.setPotEligibility(newPotIndex, playerAddr, true);
                    }
                    // Active players with remaining stack are eligible for side pot
                    else if (player.status == IStateStorage.PlayerStatus.Active) {
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
    
    // Debug logging
    console.log("---- Pot Details ----");
    console.log("Main pot: %s", gameState.mainPot);
    uint256 totalPlayerBets = 0;
    
    // Calculate total player bets for verification
    for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
        address playerAddr = stateStorage.getPlayerAtPosition(i);
        if (playerAddr != address(0)) {
            IStateStorage.Player memory player = stateStorage.getPlayer(playerAddr);
            console.log("Player at position %s bet: %s status: %s", i, player.currentBet, uint8(player.status));
            totalPlayerBets += player.currentBet;
        }
    }
    console.log("Total all player bets: %s", totalPlayerBets);
    
    // Handle side pots first
    for (uint256 i = 0; i < totalSidePots; i++) {
        (uint256 amount, bool isResolved) = stateStorage.getSidePot(i);
        if (!isResolved) {
            address[] memory winners = _determineWinnersForPot(i);
            _awardPot(i, winners, amount);
            stateStorage.setSidePotResolved(i);
        }
    }
    
    // Then handle main pot
    if (gameState.mainPot > 0) {
        address[] memory winners = _determineWinnersForPot(type(uint256).max);
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
        uint256 remainder = amount % winners.length;
        
        for (uint256 i = 0; i < winners.length; i++) {
            IStateStorage.Player memory winnerState = stateStorage.getPlayer(winners[i]);
            uint256 winnerAmount = splitAmount;
            
            // Give remainder to first player (standard poker practice)
            if (i == 0) {
                winnerAmount += remainder;
            }
            
            winnerState.stack += winnerAmount;
            stateStorage.updatePlayerState(winners[i], winnerState);
            emit PotAwarded(potIndex, winners[i], winnerAmount);
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
        
        require(gameState.currentRound < IStateStorage.BettingRound.River, "Hand complete");

        // Reset all players' current bets and action tracking
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddr);
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    player.currentBet = 0;
                    stateStorage.updatePlayerState(playerAddr, player);
                    stateStorage.setPlayerActedInRound(playerAddr, false);
                }
            }
        }
        
        // Reset betting state for new round
        gameState.currentBet = 0;
        gameState.lastRaise = 0;
        
        // Get SB position for post-flop rounds
        address sbPlayer = stateStorage.getPlayerAtPosition(1); // SB is at position 1
        
        // For post-flop rounds, start with SB if active, otherwise next active player after SB
        if (gameState.currentRound >= IStateStorage.BettingRound.PreFlop) {
            gameState.currentTurn = sbPlayer != address(0) ? 
                _getNextActivePlayer(stateStorage.getPlayerAtPosition(0)) : // Start from button to get to SB
                _getNextActivePlayer(address(0));
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
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        
        console.log("Processing fold for player at position", playerState.position);
        console.log("Player's current bet:", playerState.currentBet);
        console.log("Current main pot:", gameState.mainPot);
        
        // Update player status to folded but keep their currentBet unchanged
        // Their bet is already in the pot from previous betting actions
        playerState.status = IStateStorage.PlayerStatus.Folded;
        stateStorage.updatePlayerState(player, playerState);
        
        uint8 activeCount = _getActivePlayerCount();
        console.log("Active players remaining:", activeCount);
        
        if (activeCount == 1) {
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
            
        // Mark player as having acted
        stateStorage.setPlayerActedInRound(player, true);

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

        // Mark player as having acted
        stateStorage.setPlayerActedInRound(player, true);
        
        _moveToNextPlayer();
    }
    
    function _processRaise(address player, uint256 raiseAmount) private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory playerState = stateStorage.getPlayer(player);
        IStateStorage.TournamentState memory tournament = stateStorage.getTournamentState();
        
        require(raiseAmount > 0, "Raise amount must be positive");
        
        uint256 toCall = gameState.currentBet > playerState.currentBet ? 
            gameState.currentBet - playerState.currentBet : 0;
        
        require(raiseAmount <= type(uint256).max - toCall, "Raise amount too large");
        uint256 totalAmount = toCall + raiseAmount;
        
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
            
            // Mark player as having acted
            stateStorage.setPlayerActedInRound(player, true);
            
            // Reset other players' action flags since there's been a raise
            for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
                address otherPlayer = stateStorage.getPlayerAtPosition(i);
                if (otherPlayer != address(0) && otherPlayer != player) {
                    IStateStorage.Player memory otherPlayerState = stateStorage.getPlayer(otherPlayer);
                    if (otherPlayerState.status == IStateStorage.PlayerStatus.Active) {
                        stateStorage.setPlayerActedInRound(otherPlayer, false);
                    }
                }
            }
            
            stateStorage.updatePlayerState(player, playerState);
            stateStorage.updateGameState(gameState);
            
            _moveToNextPlayer();
        }
    }
    
    function _moveToNextPlayer() private {
        if (_getActivePlayerCount() == 1) {
            _awardPotToLastPlayer();
            return;
        }
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        bool roundComplete = _isRoundComplete();
        
        if (roundComplete) {
            bool shouldShowdown = _shouldShowdown();
            
            if (shouldShowdown) {
                _initiateShowdown();
            } else {
                _nextRound();
            }
        } else {
            address nextPlayer = _getNextActivePlayer(gameState.currentTurn);
            gameState.currentTurn = nextPlayer;
            
            stateStorage.updateGameState(gameState);
            emit ActionTimerStarted(nextPlayer, gameState.actionTimer, block.number);
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
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    return playerAtPosition;
                }
            }
        }
        
        revert("No active players found");
    }
    
    function _getActivePlayerCount() private view returns (uint8) {
        uint8 count = 0;
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddress = stateStorage.getPlayerAtPosition(i);
            if (playerAddress != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddress);
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    count++;
                }
            }
        }
        return count;
    }
    
    function _isRoundComplete() private view returns (bool) {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        
        // Special handling for pre-flop: BB must act
        if (gameState.currentRound == IStateStorage.BettingRound.PreFlop) {
            address bbPlayer = stateStorage.getPlayerAtPosition(2); // BB is at position 2
            if (bbPlayer != address(0)) {
                IStateStorage.Player memory bbPlayerState = stateStorage.getPlayer(bbPlayer);
                if (bbPlayerState.currentBet == gameState.currentBet && 
                    bbPlayerState.status == IStateStorage.PlayerStatus.Active &&
                    !stateStorage.hasPlayerActedInRound(bbPlayer)) {
                    return false;
                }
            }
        }
        
        uint8 activeCount = 0;
        uint8 actedCount = 0;
        
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddr);
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
    
    function _shouldShowdown() private view returns (bool) {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        return gameState.currentRound == IStateStorage.BettingRound.River;
    }
    
    function _initiateShowdown() private {
        // First count active players
        uint8 activeCount = _getActivePlayerCount();
        require(activeCount > 0, "No active players for showdown");
        
        // Reveal all active players' hands
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddress = stateStorage.getPlayerAtPosition(i);
            if (playerAddress != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddress);
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    handManager.revealHand(playerAddress);
                }
            }
        }
        
        // Award all pots (main pot and side pots)
        _awardPots();
        
        // Reset game state for the next hand
        _resetGameState();
    }

    function _determineWinnersForPot(uint256 potIndex) private view returns (address[] memory) {
        uint32 bestRank = type(uint32).max;
        uint8 winnerCount = 0;
        address[] memory potentialWinners = new address[](PokerConstants.MAX_PLAYERS);
        
        // Find all players with best hand
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            // For main pot (type(uint256).max), all active players are eligible
            // For side pots, check eligibility
            bool isEligible = potIndex == type(uint256).max ? true : 
                            stateStorage.isPlayerEligibleForPot(potIndex, playerAddr);
                            
            if (playerAddr != address(0) && isEligible) {
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
        
        // Return array of winners with exact size
        address[] memory winners = new address[](winnerCount);
        for (uint8 i = 0; i < winnerCount; i++) {
            winners[i] = potentialWinners[i];
        }
        
        return winners;
    }
    
    function _awardPot(address winner) private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.Player memory winnerState = stateStorage.getPlayer(winner);
        
        console.log("In _awardPot - Pot size:", gameState.mainPot);
        console.log("Winner's stack before:", winnerState.stack);
        
        winnerState.stack += gameState.mainPot;
        console.log("Winner's stack after:", winnerState.stack);
        
        stateStorage.updatePlayerState(winner, winnerState);
        
        gameState.mainPot = 0;
        stateStorage.updateGameState(gameState);
    }
    
    function _awardPotToLastPlayer() private {
        address lastPlayer;
        uint8 activePlayers = 0;
        
        console.log("Starting _awardPotToLastPlayer");
        
        // Find the last active player
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddress = stateStorage.getPlayerAtPosition(i);
            if (playerAddress != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddress);
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    lastPlayer = playerAddress;
                    activePlayers++;
                    console.log("Found active player at position", i);
                }
            }
        }
        
        require(activePlayers == 1, "More than one player active");
        
        // Get the current pot from game state
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        console.log("Current pot to award:", gameState.mainPot);
        
        // Award the pot
        console.log("Awarding pot to last player at address:", lastPlayer);
        _awardPot(lastPlayer);
        
        // Reset all players' currentBet to 0 after pot is awarded
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddress = stateStorage.getPlayerAtPosition(i);
            if (playerAddress != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddress);
                if (player.currentBet > 0) {
                    console.log("Resetting currentBet for player at position", i);
                    player.currentBet = 0;
                    stateStorage.updatePlayerState(playerAddress, player);
                }
            }
        }
        
        _resetGameState();
        emit RoundComplete(IStateStorage.BettingRound.PreFlop);
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

    // New helper function to reset the game state for a new hand
    function _resetGameState() private {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        
        // Only reset game-level state
        gameState.currentRound = IStateStorage.BettingRound.PreFlop;
        gameState.currentBet = 0;
        gameState.mainPot = 0;
        gameState.lastRaise = 0;
        gameState.currentTurn = _getNextActivePlayer(address(0));
        
        stateStorage.updateGameState(gameState);
        
        // Reset only currentBet for all players, keeping their stack changes
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddress = stateStorage.getPlayerAtPosition(i);
            if (playerAddress != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddress);
                if (player.currentBet > 0) {
                    player.currentBet = 0;
                    stateStorage.updatePlayerState(playerAddress, player);
                }
            }
        }
    }
}
