# Texas Hold'em Smart Contract Deployment Guide

## Quick Setup

```bash
npm install
```

## Compile Contracts

```bash
npx hardhat compile
```

## Deploy Contracts

The deployment script handles the complex deployment order and contract authorization:

1. Start a local node:
```bash
npx hardhat node
```

2. In a new terminal, deploy the contracts:
```bash
npx hardhat run scripts/deploy.ts --network localhost
```

The deployment process:
- Deploys StateStorage (handles game state)
- Deploys HandEvaluator (evaluates poker hands)  
- Deploys HandManager (manages cards and dealing)
- Deploys TournamentLogic (handles tournament flow)
- Deploys GameLogic (core game mechanics)
- Deploys Router (coordinates all contracts)
- Authorizes all contracts in StateStorage
- Outputs all contract addresses

## Post-Deployment Steps

Once contracts are deployed, you need to:

1. Whitelist players through the Router contract:
```typescript
await router.whitelistPlayer(playerAddress);
```

2. Start a tournament:
```typescript
await tournamentLogic.startTournament(playerAddresses);
```

## Testing

Run the full test suite:
```bash
npx hardhat test
```

Get test coverage:
```bash
npx hardhat coverage
```