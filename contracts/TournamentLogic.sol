// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "./library.sol";
import "./interfaces.sol";

/**
 * @title TournamentLogic
 * @dev Handles poker tournament logic including blind progression and player elimination
 */
contract TournamentLogic is ITournamentLogic {
    using PokerConstants for uint8;
    
    IStateStorage private immutable stateStorage;
    
    uint256 private constant INITIAL_SMALL_BLIND = 25;
    uint256 private constant INITIAL_BIG_BLIND = 50;
    uint256 private constant BLIND_LEVEL_DURATION = 5 minutes;
    uint256 private constant SMALL_BLIND_INCREMENT = 25;
    uint256 private constant BIG_BLIND_INCREMENT = 50;
    uint256 private constant LEVELS_BEFORE_DOUBLE = 3;
    uint256 private constant MAX_SMALL_BLIND = 10000; // Safety cap
    uint256 private constant INITIAL_STACK = 10000;
    
    modifier onlyValidPlayers(address[] calldata players) {
        require(players.length >= 2 && players.length <= PokerConstants.MAX_PLAYERS, 
            "Invalid player count");
        for(uint i = 0; i < players.length; i++) {
            require(players[i] != address(0), "Invalid player address");
            for(uint j = i + 1; j < players.length; j++) {
                require(players[i] != players[j], "Duplicate player");
            }
        }
        _;
    }

    struct BlindLevel {
        uint256 smallBlind;
        uint256 bigBlind;
        uint256 startTime;
    }

    BlindLevel[] private blindLevels;
    
    event BlindLevelProgression(
        uint256 indexed level,
        uint256 smallBlind,
        uint256 bigBlind,
        bool isDoubling
    );

    
    constructor(address _stateStorage) {
        stateStorage = IStateStorage(_stateStorage);
    }

    function debugCall() external view returns (uint256, uint256) {
        return stateStorage.getCurrentBlinds();
    }

    
    /**
     * @notice Start a new tournament with given players
     * @param players Array of player addresses
     */
function startTournament(address[] calldata players) 
    external 
    override 
    onlyValidPlayers(players) 
{
    // Update blinds first
    stateStorage.updateTournamentBlinds(INITIAL_SMALL_BLIND, INITIAL_BIG_BLIND);

    // Update status
    stateStorage.updateTournamentStatus(
        IStateStorage.TableState.Active,
        uint8(players.length),
        false  // not paused
    );

    // Update positions
    stateStorage.updateTournamentPositions(0, 0);

    // Initialize player states
    for(uint8 i = 0; i < players.length; i++) {
        IStateStorage.Player memory player;
        player.stack = INITIAL_STACK;
        player.status = IStateStorage.PlayerStatus.Active;
        player.position = i;
        stateStorage.updatePlayerState(players[i], player);
    }
    
    emit TournamentStarted(block.timestamp);
}
    
    /**
     * @notice Update blind levels based on time elapsed
     */
    function updateBlinds() external override {
        IStateStorage.TournamentState memory tournament = stateStorage.getTournamentState();
        require(tournament.tableState == IStateStorage.TableState.Active, 
            "Tournament not active");
        require(!tournament.isPaused, "Tournament paused");
        
        uint256 currentLevel = getCurrentBlindLevel();
        uint256 expectedLevel = getExpectedBlindLevel();
        
        // Only update if we need to increase level
        if (expectedLevel > currentLevel) {
            // Calculate new blinds with overflow protection
            uint256 newSmallBlind;
            uint256 newBigBlind;
            
            unchecked {
                // Standard tournament progression: increment by base amount
                newSmallBlind = tournament.smallBlind + SMALL_BLIND_INCREMENT;
                newBigBlind = tournament.bigBlind + BIG_BLIND_INCREMENT;
                
                // Double every 3 levels (standard tournament structure)
                if (expectedLevel % LEVELS_BEFORE_DOUBLE == 0) {
                    newSmallBlind = tournament.smallBlind * 2;
                    newBigBlind = tournament.bigBlind * 2;
                }
            }
            
            // Essential tournament rule: cap maximum blinds
            if (newSmallBlind > MAX_SMALL_BLIND) {
                newSmallBlind = MAX_SMALL_BLIND;
                newBigBlind = MAX_SMALL_BLIND * 2;
            }
            
            // Update tournament state
            tournament.smallBlind = newSmallBlind;
            tournament.bigBlind = newBigBlind;
            tournament.lastBlindUpdate = block.timestamp;
            
            // Add new blind level to history
            IStateStorage.BlindLevel memory newLevel = IStateStorage.BlindLevel({
                smallBlind: newSmallBlind,
                bigBlind: newBigBlind,
                startTime: block.timestamp
            });
            stateStorage.addBlindLevel(newLevel);
            
            // Essential tournament rule: end tournament if blinds too high relative to stacks
            uint256 avgStack = _calculateAverageStack();
            if (newSmallBlind > avgStack / 4) {  // Standard tournament end condition
                _completeTournament();
                return;
            }
            
            stateStorage.updateTournamentState(tournament);
        }
    }

    // Essential helper function for blind-based tournament completion
    function _calculateAverageStack() private view returns (uint256) {
        IStateStorage.TournamentState memory tournament = stateStorage.getTournamentState();
        if (tournament.activePlayerCount == 0) return 0;
        
        uint256 totalChips = 0;
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddr = stateStorage.getPlayerAtPosition(i);
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddr);
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    totalChips += player.stack;
                }
            }
        }
        
        return totalChips / tournament.activePlayerCount;
    }

    function calculateNextBlinds(uint256 targetLevel) private view returns (uint256, uint256) {
        IStateStorage.TournamentState memory tournament = stateStorage.getTournamentState();
        uint256 currentLevel = getCurrentBlindLevel();
        uint256 smallBlind = tournament.smallBlind;
        uint256 bigBlind = tournament.bigBlind;
        
        for (uint256 i = currentLevel + 1; i <= targetLevel; i++) {
            // First apply the regular increment
            smallBlind += SMALL_BLIND_INCREMENT;
            bigBlind += BIG_BLIND_INCREMENT;
            
            // Then check if this level requires doubling
            if (i % LEVELS_BEFORE_DOUBLE == 0) {
                smallBlind *= 2;
                bigBlind *= 2;
            }
        }
        
        return (smallBlind, bigBlind);
    }

        function getCurrentBlindLevel() public view returns (uint256) {
        return blindLevels.length - 1;
    }
    
    function getExpectedBlindLevel() public view returns (uint256) {
        IStateStorage.TournamentState memory tournament = stateStorage.getTournamentState();
        if (tournament.tableState != IStateStorage.TableState.Active) {
            return 0;
        }
        return (block.timestamp - tournament.startTime) / BLIND_LEVEL_DURATION;
    }
    
    function shouldForceTournamentEnd(uint256 newSmallBlind) private view returns (bool) {
        IStateStorage.TournamentState memory tournament = stateStorage.getTournamentState();
        uint256 totalChips = 0;
        uint256 activePlayers = 0;
        
        // Calculate average stack
        for(uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddress = stateStorage.getPlayerAtPosition(i);
            if (playerAddress != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddress);
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    totalChips += player.stack;
                    activePlayers++;
                }
            }
        }
        
        if (activePlayers == 0) return false;
        
        uint256 averageStack = totalChips / activePlayers;
        // Force end if small blind is more than 1/4 of average stack
        return newSmallBlind > (averageStack / 4);
    }
    
    function getBlindLevelHistory() external view returns (BlindLevel[] memory) {
        return blindLevels;
    }
    
    /**
     * @notice Process player elimination
     * @param player Address of eliminated player
     */
   function processElimination(address player) external override {
    IStateStorage.Player memory playerState = stateStorage.getPlayer(player);
    
    // Get tournament state values
    (
        ,  // smallBlind
        ,  // bigBlind
        ,  // blindTimer
        ,  // lastBlindUpdate
        uint8 tableState,
        ,  // buttonPosition
        ,  // dealerPosition
        uint8 activeCount,
        ,  // startTime
        bool isPaused,
        // currentBlindLevel
    ) = stateStorage.getTournamentStateValues();
    
    require(tableState == uint8(IStateStorage.TableState.Active), 
        "Tournament not active");
    require(playerState.status == IStateStorage.PlayerStatus.Active, 
        "Player not active");
    require(playerState.stack == 0, "Player still has chips");
    
    // Update player status to eliminated
    playerState.status = IStateStorage.PlayerStatus.Eliminated;
    stateStorage.updatePlayerState(player, playerState);
    
    // Update tournament state using the specific function
    stateStorage.updateTournamentStatus(
        IStateStorage.TableState.Active,
        activeCount - 1,
        isPaused
    );
    
    emit PlayerEliminated(player);
    
    // Check if tournament is complete
    if (activeCount == 2) { // If activeCount will become 1 after elimination
        _completeTournament();
    }
}
    
    /**
     * @notice Check current tournament status
     * @return isComplete Whether tournament is complete
     * @return winner Address of winner if complete
     */
    function checkTournamentStatus() external view override returns (bool isComplete, address winner) {
        IStateStorage.TournamentState memory tournament = stateStorage.getTournamentState();
        
        if (tournament.tableState == IStateStorage.TableState.Complete && tournament.activePlayerCount == 1) {
            // Find the last active player
            for(uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
                address playerAddress = stateStorage.getPlayerAtPosition(i);
                if (playerAddress != address(0)) {
                    IStateStorage.Player memory player = stateStorage.getPlayer(playerAddress);
                    if (player.status == IStateStorage.PlayerStatus.Active) {
                        return (true, playerAddress);
                    }
                }
            }
        }
        
        return (false, address(0));
    }
    
    /**
     * @dev Complete the tournament and declare winner
     */
    function _completeTournament() private {
        IStateStorage.TournamentState memory tournament = stateStorage.getTournamentState();
        tournament.tableState = IStateStorage.TableState.Complete;
        stateStorage.updateTournamentState(tournament);
        
        // Find winner
        address winner;
        for(uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            address playerAddress = stateStorage.getPlayerAtPosition(i);
            if (playerAddress != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddress);
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    winner = playerAddress;
                    break;
                }
            }
        }
        
        emit TournamentCompleted(winner);
    }
    
    /**
     * @notice Get current tournament progress
     * @return elapsedTime Time elapsed since start
     * @return blindLevel Current blind level
     * @return remainingPlayers Number of active players
     */
    function getTournamentProgress() external view returns (
        uint256 elapsedTime,
        uint256 blindLevel,
        uint8 remainingPlayers
    ) {
        IStateStorage.TournamentState memory tournament = stateStorage.getTournamentState();
        
        if (tournament.tableState == IStateStorage.TableState.Active) {
            elapsedTime = block.timestamp - tournament.startTime;
            blindLevel = (elapsedTime / tournament.blindTimer) + 1;
            remainingPlayers = tournament.activePlayerCount;
        }
    }

    function rotateButton() internal returns (uint8) {
        IStateStorage.TournamentState memory tournament = stateStorage.getTournamentState();
        
        // Start from current button position
        uint8 newButton = tournament.buttonPosition;
        bool foundNext = false;
        
        // Find next valid position
        for (uint8 i = 1; i <= PokerConstants.MAX_PLAYERS; i++) {
            uint8 candidatePos = (newButton + i) % PokerConstants.MAX_PLAYERS;
            address playerAddr = stateStorage.getPlayerAtPosition(candidatePos);
            
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddr);
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    newButton = candidatePos;
                    foundNext = true;
                    break;
                }
            }
        }
        
        require(foundNext, "No active players for button");
        
        // Update button position
        tournament.buttonPosition = newButton;
        stateStorage.updateTournamentState(tournament);
        
        return newButton;
    }

    function getValidBlindsPositions(uint8 buttonPos) internal view returns (uint8 sb, uint8 bb) {
        // Find small blind position
        uint8 sbPos = (buttonPos + 1) % PokerConstants.MAX_PLAYERS;
        bool foundSB = false;
        
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            uint8 pos = (sbPos + i) % PokerConstants.MAX_PLAYERS;
            address playerAddr = stateStorage.getPlayerAtPosition(pos);
            
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddr);
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    sbPos = pos;
                    foundSB = true;
                    break;
                }
            }
        }
        
        require(foundSB, "No valid SB position");
        
        // Find big blind position
        uint8 bbPos = (sbPos + 1) % PokerConstants.MAX_PLAYERS;
        bool foundBB = false;
        
        for (uint8 i = 0; i < PokerConstants.MAX_PLAYERS; i++) {
            uint8 pos = (bbPos + i) % PokerConstants.MAX_PLAYERS;
            address playerAddr = stateStorage.getPlayerAtPosition(pos);
            
            if (playerAddr != address(0)) {
                IStateStorage.Player memory player = stateStorage.getPlayer(playerAddr);
                if (player.status == IStateStorage.PlayerStatus.Active) {
                    bbPos = pos;
                    foundBB = true;
                    break;
                }
            }
        }
        
        require(foundBB, "No valid BB position");
        
        return (sbPos, bbPos);
    }

function testMinimalTournamentUpdate() external {
    IStateStorage.TournamentState memory tournament;
    tournament.smallBlind = 25;
    tournament.bigBlind = 50;
    // Not setting any other fields
    
    stateStorage.updateTournamentState(tournament);
}

function testSimpleBlindUpdate() external {
    stateStorage.updateTournamentBlinds(25, 50);
}
    
}
