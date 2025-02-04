// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface IStateStorage {
    enum PlayerStatus { Inactive, Active, Folded, Eliminated }
    enum TableState { Waiting, Active, Complete }
    enum BettingRound { PreFlop, Flop, Turn, River }
    
    struct BlindLevel {
        uint256 smallBlind;
        uint256 bigBlind;
        uint256 startTime;
    }
    
    struct Player {
        uint256 stack;
        PlayerStatus status;
        uint256 currentBet;
        uint8 position;
        uint8[2] holeCards;
        uint256 lastActionTime;
    }
    
    struct TournamentState {
        uint256 smallBlind;
        uint256 bigBlind;
        uint256 blindTimer;
        uint256 lastBlindUpdate;
        TableState tableState;
        uint8 buttonPosition;
        uint8 dealerPosition;
        uint8 activePlayerCount;
        uint256 startTime;
        bool isPaused;
        uint256 currentBlindLevel;
        //BlindLevel[] blindHistory;
    }
    
    struct GameState {
        uint256 actionTimer;
        uint8[5] communityCards;
        BettingRound currentRound;
        uint256 mainPot;
        uint256 currentBet;
        uint256 lastRaise;
        uint256 minRaise;
        uint8 lastAggressor;
        address currentTurn;
        uint256 handStartTime;
        uint256 lastActionAmount;
    }

    struct SidePot {
        uint256 amount;
        bool isResolved;
    }
    
    // Core State Functions
    function getPlayer(address player) external view returns (Player memory);
    function getTournamentState() external view returns (TournamentState memory);
    function getGameState() external view returns (GameState memory);
    
    // Game Progress Functions
    function advanceRound() external;
    function updateBlinds() external;
    function rotateDealerButton() external;
    function pauseTournament() external;
    function resumeTournament() external;
    function eliminatePlayer(address player) external;
    
    // State Update Functions
    function updatePlayerState(address player, Player memory newState) external;
    function updateTournamentState(TournamentState memory newState) external;
    function updateGameState(GameState memory newState) external;
    
    // Card Visibility Functions
    function getHoleCards(address player) external view returns (uint8[2] memory);
    function revealFoldedHand(address player) external;
    function showdownReveal(address player) external;
    function getBestHand(address player) external view returns (uint256);
    
    // Required Functions
    function registerPlayer(address player) external;
    function getCurrentBlinds() external view returns (uint256, uint256);
    function getPlayerAtPosition(uint8 position) external view returns (address);
    
    // Admin Functions
    function whitelistPlayer(address player) external;

    //SidePot
    function sidePotCount() external view returns (uint256);
    function createSidePot(uint256 index, uint256 amount) external;
    function setPotEligibility(uint256 potIndex, address player, bool eligible) external;

    function getSidePot(uint256 index) external view returns (uint256 amount, bool isResolved);
    function setSidePotResolved(uint256 index) external;

    function isPlayerEligibleForPot(uint256 potIndex, address player) external view returns (bool);

    //Blind management
    function getCurrentBlindLevel() external view returns (BlindLevel memory);
    function getBlindHistory() external view returns (BlindLevel[] memory);
    function addBlindLevel(BlindLevel memory newLevel) external;

    function getTournamentStateValues() external view returns (
        uint256 smallBlind, 
        uint256 bigBlind,
        uint256 blindTimer,
        uint256 lastBlindUpdate,
        uint8 tableState,
        uint8 buttonPosition,
        uint8 dealerPosition,
        uint8 activePlayerCount,
        uint256 startTime,
        bool isPaused,
        uint256 currentBlindLevel
    );

    function getGameStateValues() external view returns (
        uint256 actionTimer,
        uint8[5] memory communityCards,
        uint8 currentRound,
        uint256 mainPot,
        uint256 currentBet,
        uint256 lastRaise,
        uint256 minRaise,
        uint8 lastAggressor,
        address currentTurn,
        uint256 handStartTime,
        uint256 lastActionAmount
    );

    function updateGameBasics(
        uint8 currentRound,
        uint256 mainPot,
        uint256 currentBet,
        address currentTurn
    ) external;

    function updateGameCards(uint8[5] calldata communityCards) external;

    function updateGameTimers(
        uint256 actionTimer,
        uint256 handStartTime
    ) external;

    function getTournamentStateArray() external view returns (
    uint256[] memory values, 
    uint8[] memory smallValues, 
    bool isPaused
    );

    function updateTournamentBlinds(uint256 small, uint256 big) external;

    function updateTournamentStatus(
        TableState newState,
        uint8 activeCount,
        bool isPaused
    ) external;

    function updateTournamentPositions(
        uint8 button,
        uint8 dealer
    ) external;
}

interface IGameLogic {
    event ActionTaken(address indexed player, uint8 action, uint256 amount);
    event RoundStarted(IStateStorage.BettingRound round);
    event PlayerTimedOut(address indexed player);
    event ActionTimerStarted(address indexed player, uint256 duration, uint256 blockNumber);
    event RoundComplete(IStateStorage.BettingRound round);


    /// @notice Process player action
    /// @param player Player address
    /// @param action 0=Fold, 1=Check, 2=Call, 3=Raise
    /// @param amount Bet amount
    function processAction(address player, uint8 action, uint256 amount) external;

    /// @notice Start next betting round
    function nextRound() external;

    /// @notice Handle player timeout from authorized timer
    /// @param player The player who timed out
    function handlePlayerTimeout(address player) external;

    /// @notice Get valid actions for player
    /// @param player Player to check
    /// @return validActions Array of valid action flags
    function getValidActions(address player) external view returns (bool[] memory validActions);
}

interface ITournamentLogic {
    event TournamentStarted(uint256 startTime);
    event BlindsIncreased(uint256 smallBlind, uint256 bigBlind);
    event PlayerEliminated(address indexed player);
    event TournamentCompleted(address indexed winner);

    /// @notice Start tournament
    /// @param players Initial players
    function startTournament(address[] calldata players) external;

    /// @notice Update blind levels
    function updateBlinds() external;

    /// @notice Process elimination
    /// @param player Eliminated player
    function processElimination(address player) external;

    /// @notice Check tournament status
    /// @return isComplete Tournament ended
    /// @return winner Winner if complete
    function checkTournamentStatus() external view returns (bool isComplete, address winner);

     function getTournamentProgress() external view returns (
        uint256 elapsedTime,
        uint256 blindLevel,
        uint8 remainingPlayers
    );
}

interface IRouter {
    event ContractUpgraded(uint8 indexed contractType, address implementation);
    event TimerBackendAdded(address indexed backend);
    event TimerBackendRemoved(address indexed backend);
    
    /// @notice Route game action
    /// @param action Action type
    /// @param data Action data
    function routeGameAction(uint8 action, bytes calldata data) external;

    /// @notice Route tournament action  
    /// @param selector Function selector
    /// @param data Function data
    function routeTournamentAction(bytes4 selector, bytes calldata data) external;

    /// @notice Route timeout action
    /// @param player The player who timed out
    function routeTimeoutAction(address player) external;

    /// @notice Route blind update
    function routeBlindUpdate() external;

    /// @notice Upgrade contract
    /// @param contractType Contract to upgrade
    /// @param implementation New implementation
    function upgradeContract(uint8 contractType, address implementation) external;
}
