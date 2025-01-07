// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "./library.sol";
import "./interfaces.sol";

/**
 * @title HandManager
 * @dev Handles all card dealing and hand management for poker games
 */
contract HandManager {
    using DeckManager for DeckManager.Deck;
    using PokerConstants for uint8;

    bool private dealing;
    
    DeckManager.Deck private deck;
    IStateStorage private stateStorage;
    
    event HandDealt(address indexed player, uint8 position);
    event CommunityCardsDealt(uint8[] cards, uint8 count);
    event HandRevealed(address indexed player, uint8[2] cards);
    
    modifier onlyValidState() {
        IStateStorage.TournamentState memory tournament = stateStorage.getTournamentState();
        require(tournament.tableState != IStateStorage.TableState.Complete, "Game is complete");
        require(!tournament.isPaused, "Game is paused");
        require(tournament.currentBlindLevel < 100, "Tournament blind cap reached"); // Added safety check
        _;
    }

    modifier whileDealing() {
        require(!dealing, "Cards being dealt");
        dealing = true;
        _;
        dealing = false;
    }
    
    constructor(address _stateStorage) {
        stateStorage = IStateStorage(_stateStorage);
        deck = DeckManager.initializeDeck();
    }
    
    /**
     * @dev Start a new hand, dealing cards to all players
     * @return dealerSeed The seed used for shuffling
     */
    function startNewHand() external onlyValidState returns (bytes32 dealerSeed) {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        IStateStorage.TournamentState memory tournamentState = stateStorage.getTournamentState();
        
        // Essential poker validation - can't start new hand while one is in progress
        require(tournamentState.tableState == IStateStorage.TableState.Waiting || 
                gameState.currentRound == IStateStorage.BettingRound.River,
            "Hand in progress");
        
        // Essential poker rule - minimum 2 players needed for a hand
        require(tournamentState.activePlayerCount >= 2, "Not enough players");
        
        // Essential poker state reset
        gameState.currentRound = IStateStorage.BettingRound.PreFlop;
        gameState.mainPot = 0;
        gameState.currentBet = tournamentState.bigBlind;
        
        // Essential blind position verification and posting
        uint8 sbPos = (tournamentState.buttonPosition + 1) % PokerConstants.MAX_PLAYERS;
        uint8 bbPos = (tournamentState.buttonPosition + 2) % PokerConstants.MAX_PLAYERS;
        
        address sbPlayer = stateStorage.getPlayerAtPosition(sbPos);
        address bbPlayer = stateStorage.getPlayerAtPosition(bbPos);
        
        // Essential poker rule - blinds must be postable
        IStateStorage.Player memory sbPlayerState = stateStorage.getPlayer(sbPlayer);
        IStateStorage.Player memory bbPlayerState = stateStorage.getPlayer(bbPlayer);
        require(sbPlayerState.stack >= tournamentState.smallBlind, "SB cannot post");
        require(bbPlayerState.stack >= tournamentState.bigBlind, "BB cannot post");
        
        // Post blinds - essential poker mechanic
        sbPlayerState.stack -= tournamentState.smallBlind;
        sbPlayerState.currentBet = tournamentState.smallBlind;
        bbPlayerState.stack -= tournamentState.bigBlind;
        bbPlayerState.currentBet = tournamentState.bigBlind;
        
        stateStorage.updatePlayerState(sbPlayer, sbPlayerState);
        stateStorage.updatePlayerState(bbPlayer, bbPlayerState);
        
        // Reset deck and get seed - delegating details to DeckManager
        deck = DeckManager.initializeDeck();
        deck.shuffle();
        dealerSeed = deck.lastSeed;
        
        // Essential poker mechanic - deal 2 cards to each active player starting from button
        uint8 currentPosition = tournamentState.buttonPosition;
        uint8 dealtCount = 0;
        
        while (dealtCount < tournamentState.activePlayerCount) {
            currentPosition = (currentPosition + 1) % PokerConstants.MAX_PLAYERS;
            address playerAddr = stateStorage.getPlayerAtPosition(currentPosition);
            
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddr);
                if (player.status == IStateStorage.PlayerStatus.Active && player.stack > 0) {
                    // Reset previous hand state - essential for new hand
                    player.currentBet = (playerAddr == sbPlayer) ? tournamentState.smallBlind :
                                    (playerAddr == bbPlayer) ? tournamentState.bigBlind : 0;
                    
                    // Deal new hole cards - core poker mechanic
                    player.holeCards = deck.dealHoleCards(currentPosition);
                    stateStorage.updatePlayerState(playerAddr, player);
                    emit HandDealt(playerAddr, currentPosition);
                    dealtCount++;
                }
            }
        }
        
        stateStorage.updateGameState(gameState);
        return dealerSeed;
    }
    
    /**
     * @dev Deal the flop (3 community cards)
     * @return cards The three flop cards
     */
    function dealFlop() external whileDealing returns (uint8[] memory) {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        require(gameState.currentRound == IStateStorage.BettingRound.PreFlop, "Not time for flop");
        
        uint8[] memory flopCards = deck.dealCommunityCards(3);
        emit CommunityCardsDealt(flopCards, 3);
        return flopCards;
    }
    
    /**
     * @dev Deal the turn (1 community card)
     * @return card The turn card
     */
    function dealTurn() external whileDealing returns (uint8[] memory) {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        require(gameState.currentRound == IStateStorage.BettingRound.Flop, "Not time for turn");
        
        uint8[] memory turnCard = deck.dealCommunityCards(1);
        emit CommunityCardsDealt(turnCard, 1);
        return turnCard;
    }
    
    /**
     * @dev Deal the river (1 community card)
     * @return card The river card
     */
    function dealRiver() external whileDealing returns (uint8[] memory) {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        require(gameState.currentRound == IStateStorage.BettingRound.Turn, "Not time for river");
        
        uint8[] memory riverCard = deck.dealCommunityCards(1);
        emit CommunityCardsDealt(riverCard, 1);
        return riverCard;
    }
    
    /**
     * @dev Reveal a player's hand (used for both folded hands and showdown)
     * @param player Address of the player whose hand to reveal
     */
    function revealHand(address player) external onlyValidState {
        IStateStorage.Player memory playerState = stateStorage.getPlayer(player);
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        
        require(playerState.status == IStateStorage.PlayerStatus.Folded || 
                gameState.currentRound == IStateStorage.BettingRound.River,
            "Can only reveal folded hands or during showdown");
            
        emit HandRevealed(player, playerState.holeCards);
    }
}
