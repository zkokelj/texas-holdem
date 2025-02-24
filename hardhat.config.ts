import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";


dotenv.config();

// Check if environment variables are set
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const TEN_RPC_URL = process.env.TEN_RPC_URL || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",  // Latest stable Solidity version
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    ten: {
      url: TEN_RPC_URL,
      chainId: 443, // TEN testnet chain ID
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    }
    // Add other networks as needed
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};

export default config;