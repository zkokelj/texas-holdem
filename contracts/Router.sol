// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "./interfaces.sol";
import "./library.sol";

/**
 * @title Router
 * @dev Coordinates interactions between poker contracts and handles access control
 */
contract Router is IRouter {
    using PokerConstants for uint8;

    // Contract type constants
    uint8 private constant STATE_STORAGE = 0;
    uint8 private constant GAME_LOGIC = 1;
    uint8 private constant TOURNAMENT_LOGIC = 2;
    uint8 private constant HAND_MANAGER = 3;
    uint8 private constant HAND_EVALUATOR = 4;
    
    // Contract addresses
    address private immutable owner;
    address private stateStorage;
    address private gameLogic;
    address private tournamentLogic;
    address private handManager;
    address private handEvaluator;
    
    // Access control
    mapping(address => bool) private admins;
    mapping(address => bool) private whitelistedPlayers;
    mapping(address => bool) private authorizedTimers;
    
    // Action types
    uint8 private constant FOLD = 0;
    uint8 private constant CHECK = 1;
    uint8 private constant CALL = 2;
    uint8 private constant RAISE = 3;
    
    // Events
    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event PlayerWhitelisted(address indexed player);
    event PlayerBlacklisted(address indexed player);

        event BlindLevelUpdated(
        uint256 indexed level,
        uint256 smallBlind,
        uint256 bigBlind,
        uint256 timestamp
    );
    
    event BlindUpdateScheduled(
        uint256 indexed currentLevel,
        uint256 nextUpdateTime
    );
    
    event TournamentStateUpdated(
        uint256 indexed blindLevel,
        uint8 remainingPlayers,
        uint256 averageStack
    );
    
    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }
    
    modifier onlyAdmin() {
        require(admins[msg.sender], "Only admin");
        _;
    }
    
    modifier onlyWhitelisted() {
        require(whitelistedPlayers[msg.sender], "Not whitelisted");
        _;
    }

    modifier onlyTimerBackend() {
        require(authorizedTimers[msg.sender], "Not authorized timer");
        _;
    }
    
    constructor(
        address _stateStorage,
        address _gameLogic,
        address _tournamentLogic,
        address _handManager,
        address _handEvaluator
    ) {
        owner = msg.sender;
        admins[msg.sender] = true;
        
        stateStorage = _stateStorage;
        gameLogic = _gameLogic;
        tournamentLogic = _tournamentLogic;
        handManager = _handManager;
        handEvaluator = _handEvaluator;
    }

        function routeBlindUpdate() external override onlyTimerBackend {
        IStateStorage.TournamentState memory tournament = 
            IStateStorage(stateStorage).getTournamentState();
            
        require(tournament.tableState == IStateStorage.TableState.Active, 
            "Tournament not active");
        require(!tournament.isPaused, "Tournament paused");
        
        // Update blinds through tournament logic
        ITournamentLogic(tournamentLogic).updateBlinds();
        
        // Get updated tournament state
        tournament = IStateStorage(stateStorage).getTournamentState();
        
        // Calculate and emit average stack information
        uint256 averageStack = _calculateAverageStack();
        
        // Emit events for front-end tracking
        emit BlindLevelUpdated(
            tournament.currentBlindLevel,
            tournament.smallBlind,
            tournament.bigBlind,
            block.timestamp
        );
        
        emit TournamentStateUpdated(
            tournament.currentBlindLevel,
            tournament.activePlayerCount,
            averageStack
        );
        
        // Schedule next blind update
        uint256 nextUpdateTime = tournament.lastBlindUpdate + tournament.blindTimer;
        emit BlindUpdateScheduled(
            tournament.currentBlindLevel,
            nextUpdateTime
        );
    }
    
    // Helper function to calculate average stack
    function _calculateAverageStack() private view returns (uint256) {
        IStateStorage.TournamentState memory tournament = 
            IStateStorage(stateStorage).getTournamentState();
        
        if (tournament.activePlayerCount == 0) return 0;
        
        uint256 totalChips = 0;
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = IStateStorage(stateStorage).getPlayerAtPosition(i);
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = 
                    IStateStorage(stateStorage).getPlayer(playerAddr);
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    totalChips += player.stack;
                }
            }
        }
        
        return totalChips / tournament.activePlayerCount;
    }

    /**
     * @notice Route game actions to appropriate contract
     * @param action Action type (0=Fold, 1=Check, 2=Call, 3=Raise)
     * @param data Encoded action data
     */
    function routeGameAction(uint8 action, bytes calldata data) 
        external 
        override 
        onlyWhitelisted 
    {
        require(action <= RAISE, "Invalid action");
        
        IStateStorage.TournamentState memory tournamentState = 
            IStateStorage(stateStorage).getTournamentState();
            
        require(tournamentState.tableState == IStateStorage.TableState.Active, 
            "Tournament not active");
        require(!tournamentState.isPaused, "Tournament paused");
        
        if (action == FOLD) {
            IGameLogic(gameLogic).processAction(msg.sender, FOLD, 0);
        } else if (action == CHECK) {
            IGameLogic(gameLogic).processAction(msg.sender, CHECK, 0);
        } else if (action == CALL) {
            IGameLogic(gameLogic).processAction(msg.sender, CALL, 0);
        } else if (action == RAISE) {
            require(data.length == 32, "Invalid raise data");
            uint256 raiseAmount = abi.decode(data, (uint256));
            IGameLogic(gameLogic).processAction(msg.sender, RAISE, raiseAmount);
        }
    }

    /**
     * @notice Handle timeout actions from authorized backend
     * @param player The player who timed out
     */
    function routeTimeoutAction(address player) external onlyTimerBackend {
        IStateStorage.TournamentState memory tournamentState = 
            IStateStorage(stateStorage).getTournamentState();
            
        require(tournamentState.tableState == IStateStorage.TableState.Active, 
            "Tournament not active");
        require(!tournamentState.isPaused, "Tournament paused");
        
        IGameLogic(gameLogic).handlePlayerTimeout(player);
    }
    
    /**
     * @notice Route tournament actions
     * @param selector Function selector
     * @param data Function data
     */
    function routeTournamentAction(bytes4 selector, bytes calldata data) 
        external 
        override 
        onlyAdmin 
    {
        require(tournamentLogic != address(0), "Tournament logic not set");
        
        (bool success, bytes memory result) = tournamentLogic.call(
            abi.encodePacked(selector, data)
        );
        
        require(success, string(result));
    }
    
    /**
     * @notice Upgrade contract implementation
     * @param contractType Type of contract to upgrade
     * @param implementation New implementation address
     */
    function upgradeContract(uint8 contractType, address implementation) 
        external 
        override 
        onlyOwner 
    {
        require(implementation != address(0), "Invalid implementation");
        
        if (contractType == STATE_STORAGE) {
            stateStorage = implementation;
        } else if (contractType == GAME_LOGIC) {
            gameLogic = implementation;
        } else if (contractType == TOURNAMENT_LOGIC) {
            tournamentLogic = implementation;
        } else if (contractType == HAND_MANAGER) {
            handManager = implementation;
        } else if (contractType == HAND_EVALUATOR) {
            handEvaluator = implementation;
        } else {
            revert("Invalid contract type");
        }
        
        emit ContractUpgraded(contractType, implementation);
    }

    // Timer Backend Management
    
    /**
     * @notice Add authorized timer backend
     * @param backend Address to authorize
     */
    function addTimerBackend(address backend) external onlyOwner {
        require(backend != address(0), "Invalid address");
        require(!authorizedTimers[backend], "Already authorized");
        authorizedTimers[backend] = true;
        emit TimerBackendAdded(backend);
    }
    
    /**
     * @notice Remove timer backend authorization
     * @param backend Address to deauthorize
     */
    function removeTimerBackend(address backend) external onlyOwner {
        require(authorizedTimers[backend], "Not authorized");
        authorizedTimers[backend] = false;
        emit TimerBackendRemoved(backend);
    }
    
    // Admin Management
    
    /**
     * @notice Add new admin
     * @param admin Address to add as admin
     */
    function addAdmin(address admin) external onlyOwner {
        require(admin != address(0), "Invalid address");
        require(!admins[admin], "Already admin");
        admins[admin] = true;
        emit AdminAdded(admin);
    }
    
    /**
     * @notice Remove admin
     * @param admin Address to remove from admins
     */
    function removeAdmin(address admin) external onlyOwner {
        require(admin != owner, "Cannot remove owner");
        require(admins[admin], "Not admin");
        admins[admin] = false;
        emit AdminRemoved(admin);
    }
    
    /**
     * @notice Whitelist player for tournament
     * @param player Player address to whitelist
     */
    function whitelistPlayer(address player) external onlyAdmin {
        require(player != address(0), "Invalid address");
        require(!whitelistedPlayers[player], "Already whitelisted");
        whitelistedPlayers[player] = true;
        emit PlayerWhitelisted(player);
    }
    
    /**
     * @notice Remove player from whitelist
     * @param player Player address to remove
     */
    function blacklistPlayer(address player) external onlyAdmin {
        require(whitelistedPlayers[player], "Not whitelisted");
        whitelistedPlayers[player] = false;
        emit PlayerBlacklisted(player);
    }

    // View Functions
    
    /**
     * @notice Check if address is admin
     * @param account Address to check
     * @return isAdmin True if address is admin
     */
    function isAdmin(address account) external view returns (bool) {
        return admins[account];
    }
    
    /**
     * @notice Check if player is whitelisted
     * @param player Address to check
     * @return isWhitelisted True if player is whitelisted
     */
    function isWhitelisted(address player) external view returns (bool) {
        return whitelistedPlayers[player];
    }

    /**
     * @notice Check if backend is authorized timer
     * @param backend Address to check
     * @return isAuthorized True if backend is authorized timer
     */
    function isAuthorizedTimer(address backend) external view returns (bool) {
        return authorizedTimers[backend];
    }
    
    /**
     * @notice Get contract address by type
     * @param contractType Type of contract
     * @return implementation Contract address
     */
    function getImplementation(uint8 contractType) external view returns (address) {
        if (contractType == STATE_STORAGE) return stateStorage;
        if (contractType == GAME_LOGIC) return gameLogic;
        if (contractType == TOURNAMENT_LOGIC) return tournamentLogic;
        if (contractType == HAND_MANAGER) return handManager;
        if (contractType == HAND_EVALUATOR) return handEvaluator;
        revert("Invalid contract type");
    }
}
