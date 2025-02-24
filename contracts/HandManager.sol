// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import './library.sol';
import './interfaces.sol';

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
        IStateStorage.TournamentState memory tournament = stateStorage
            .getTournamentState();
        require(
            tournament.tableState != IStateStorage.TableState.Complete,
            'Game is complete'
        );
        require(!tournament.isPaused, 'Game is paused');
        require(
            tournament.currentBlindLevel < 100,
            'Tournament blind cap reached'
        ); // Added safety check
        _;
    }

    modifier whileDealing() {
        require(!dealing, 'Cards being dealt');
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
    function startNewHand()
        external
        onlyValidState
        returns (bytes32 dealerSeed)
    {
        // Validate states and requirements
        (
            uint256 smallBlind,
            uint256 bigBlind,
            uint8 buttonPos,
            uint8 activePlayerCount
        ) = _validateAndGetInitialState();

        // Handle blinds and positions
        (address sbPlayer, address bbPlayer) = _handleBlinds(
            buttonPos,
            smallBlind,
            bigBlind
        );

        // Deal cards and setup deck
        dealerSeed = _dealCards(
            buttonPos,
            activePlayerCount,
            sbPlayer,
            bbPlayer,
            smallBlind,
            bigBlind
        );

        // Set first player to act
        address firstToAct = _getNextActivePlayer(bbPlayer);
        stateStorage.updateGameBasics(
            uint8(IStateStorage.BettingRound.PreFlop),
            0, // mainPot
            bigBlind, // currentBet
            firstToAct // currentTurn
        );

        return dealerSeed;
    }

    function _validateAndGetInitialState()
        private
        view
        returns (
            uint256 smallBlind,
            uint256 bigBlind,
            uint8 buttonPos,
            uint8 activePlayerCount
        )
    {
        uint256 _smallBlind;
        uint256 _bigBlind;
        uint8 _tableState;
        uint8 _buttonPos;
        uint8 _activePlayerCount;
        bool _isPaused;

        // Get tournament state values
        (
            _smallBlind,
            _bigBlind, // blindTimer
            ,
            ,
            // lastBlindUpdate
            _tableState,
            _buttonPos, // dealerPos
            ,
            _activePlayerCount, // startTime
            ,
            _isPaused,
            // currentBlindLevel

        ) = stateStorage.getTournamentStateValues();

        require(
            _tableState == uint8(IStateStorage.TableState.Active),
            'Tournament not active'
        );
        require(!_isPaused, 'Tournament is paused');
        require(_activePlayerCount >= 2, 'Not enough players');

        return (_smallBlind, _bigBlind, _buttonPos, _activePlayerCount);
    }

    function _handleBlinds(
        uint8 buttonPos,
        uint256 smallBlind,
        uint256 bigBlind
    ) private returns (address sbPlayer, address bbPlayer) {
        // Essential blind position verification and posting
        uint8 sbPos = (buttonPos + 1) % PokerConstants.MAX_PLAYERS;
        uint8 bbPos = (buttonPos + 2) % PokerConstants.MAX_PLAYERS;

        sbPlayer = stateStorage.getPlayerAtPosition(sbPos);
        bbPlayer = stateStorage.getPlayerAtPosition(bbPos);

        IStateStorage.Player memory sbPlayerState = stateStorage.getPlayer(
            sbPlayer
        );
        IStateStorage.Player memory bbPlayerState = stateStorage.getPlayer(
            bbPlayer
        );

        require(sbPlayerState.stack >= smallBlind, 'SB cannot post');
        require(bbPlayerState.stack >= bigBlind, 'BB cannot post');

        sbPlayerState.stack -= smallBlind;
        sbPlayerState.currentBet = smallBlind;
        sbPlayerState.totalContribution += smallBlind;
        bbPlayerState.stack -= bigBlind;
        bbPlayerState.currentBet = bigBlind;
        bbPlayerState.totalContribution += bigBlind;

        stateStorage.updatePlayerState(sbPlayer, sbPlayerState);
        stateStorage.updatePlayerState(bbPlayer, bbPlayerState);

        return (sbPlayer, bbPlayer);
    }

    function _dealCards(
        uint8 buttonPos,
        uint8 activePlayerCount,
        address sbPlayer,
        address bbPlayer,
        uint256 smallBlind,
        uint256 bigBlind
    ) private returns (bytes32) {
        // Initialize game state for new hand
        uint8[5] memory emptyCards = [0, 0, 0, 0, 0];
        stateStorage.updateGameCards(emptyCards);
        stateStorage.updateGameBasics(
            uint8(IStateStorage.BettingRound.PreFlop),
            0, // mainPot
            bigBlind, // currentBet
            address(0) // currentTurn will be set after dealing
        );
        stateStorage.updateGameTimers(30 seconds, block.timestamp);

        // Reset deck and get seed
        deck = DeckManager.initializeDeck();
        deck.shuffle();
        bytes32 dealerSeed = deck.lastSeed;

        // Deal cards to players
        uint8 currentPosition = buttonPos;
        uint8 dealtCount = 0;

        while (dealtCount < activePlayerCount) {
            currentPosition =
                (currentPosition + 1) %
                PokerConstants.MAX_PLAYERS;
            address playerAddr = stateStorage.getPlayerAtPosition(
                currentPosition
            );

            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(
                    playerAddr
                );
                if (
                    player.status == IStateStorage.PlayerStatus.Active &&
                    player.stack > 0
                ) {
                    player.currentBet = (playerAddr == sbPlayer)
                        ? smallBlind
                        : (playerAddr == bbPlayer)
                            ? bigBlind
                            : 0;

                    player.holeCards = deck.dealHoleCards(currentPosition);
                    stateStorage.updatePlayerState(playerAddr, player);
                    emit HandDealt(playerAddr, currentPosition);
                    dealtCount++;
                }
            }
        }

        return dealerSeed;
    }

    function _getNextActivePlayer(
        address currentPlayer
    ) private view returns (address) {
        IStateStorage.Player memory player = stateStorage.getPlayer(
            currentPlayer
        );
        uint8 currentPosition = player.position;

        for (uint8 i = 1; i <= PokerConstants.MAX_PLAYERS; i++) {
            uint8 nextPosition = (currentPosition + i) %
                PokerConstants.MAX_PLAYERS;
            address playerAtPosition = stateStorage.getPlayerAtPosition(
                nextPosition
            );

            if (playerAtPosition != address(0)) {
                IStateStorage.Player memory nextPlayer = stateStorage.getPlayer(
                    playerAtPosition
                );
                if (
                    nextPlayer.status == IStateStorage.PlayerStatus.Active &&
                    nextPlayer.stack > 0
                ) {
                    return playerAtPosition;
                }
            }
        }

        revert('No active players found');
    }

    /**
     * @dev Deal the flop (3 community cards)
     * @return cards The three flop cards
     */
    function dealFlop() external whileDealing returns (uint8[] memory) {
        IStateStorage.GameState memory gameState = stateStorage.getGameState();
        require(
            gameState.currentRound == IStateStorage.BettingRound.PreFlop,
            'Not time for flop'
        );

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
        require(
            gameState.currentRound == IStateStorage.BettingRound.Flop,
            'Not time for turn'
        );

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
        require(
            gameState.currentRound == IStateStorage.BettingRound.Turn,
            'Not time for river'
        );

        uint8[] memory riverCard = deck.dealCommunityCards(1);
        emit CommunityCardsDealt(riverCard, 1);
        return riverCard;
    }

    /**
     * @dev Reveal a player's hand (used for both folded hands and showdown)
     * @param player Address of the player whose hand to reveal
     */
    function revealHand(address player) external onlyValidState {
        IStateStorage.Player memory playerState = stateStorage.getPlayer(
            player
        );
        IStateStorage.GameState memory gameState = stateStorage.getGameState();

        require(
            playerState.status == IStateStorage.PlayerStatus.Folded ||
                gameState.currentRound == IStateStorage.BettingRound.River,
            'Can only reveal folded hands or during showdown'
        );

        emit HandRevealed(player, playerState.holeCards);
    }

    //Debug
    // Test the first step
    function testValidateState()
        external
        view
        returns (
            uint256 smallBlind,
            uint256 bigBlind,
            uint8 buttonPos,
            uint8 activePlayerCount
        )
    {
        return _validateAndGetInitialState();
    }

    // Test blind handling
    function testHandleBlinds(
        uint8 buttonPos,
        uint256 smallBlind,
        uint256 bigBlind
    ) external returns (address sbPlayer, address bbPlayer) {
        return _handleBlinds(buttonPos, smallBlind, bigBlind);
    }

    // Test card dealing setup
    function testDealSetup() external {
        uint8[5] memory emptyCards = [0, 0, 0, 0, 0];
        stateStorage.updateGameCards(emptyCards);
        stateStorage.updateGameBasics(
            uint8(IStateStorage.BettingRound.PreFlop),
            0, // mainPot
            50, // currentBet (using default big blind)
            address(0) // currentTurn
        );
        stateStorage.updateGameTimers(30 seconds, block.timestamp);
    }

    function testDeckSetup() external returns (bytes32) {
        // Reset deck and get seed
        deck = DeckManager.initializeDeck();
        deck.shuffle();
        return deck.lastSeed;
    }
}
