// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

import * as fs from "fs";
import * as path from "path";

/**
 * Configuration interface
 */
export interface Config {
    AAVE_POOL?: string;
    PYTH_ORACLE?: string;
    USDC?: string;
    DAI?: string;
    DEFAULT_TOKEN0_ADDRESS?: string;
    DEFAULT_TOKEN1_ADDRESS?: string;
    PRICE_ID?: string;
    K?: string;
    MAX_STALENESS?: string;
    IS_TOKEN_IN_BASE?: boolean;
    BASE_DECIMALS?: number;
    QUOTE_DECIMALS?: number;
}

/**
 * Load configuration from config.json with environment variable overrides
 * Environment variables take precedence over config.json values
 */
export function loadConfig(): Config {
    // Find config.json relative to this file
    const configPath = path.join(__dirname, 'config.json');
    let config: Config = {};

    // Load from config.json if it exists
    if (fs.existsSync(configPath)) {
        try {
            const configFile = fs.readFileSync(configPath, 'utf-8');
            config = JSON.parse(configFile);
            return config;
        } catch (error) {
            console.warn(`⚠️  Failed to load config.json: ${error}`);
            return {};
        }
    }

    return {};
}

