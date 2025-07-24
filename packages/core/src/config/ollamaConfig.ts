/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Configuration interface for Ollama integration
 */
export interface OllamaConfig {
  /** Base URL for Ollama server */
  baseUrl: string;
  /** Default model to use for generation */
  defaultModel: string;
  /** Request timeout in milliseconds */
  timeout: number;
  /** Maximum number of retries for failed requests */
  maxRetries: number;
  /** Whether to test connection during setup */
  connectionTestEnabled: boolean;
  /** Advanced generation options */
  advancedOptions?: OllamaAdvancedOptions;
}

/**
 * Advanced options for Ollama generation
 */
export interface OllamaAdvancedOptions {
  /** Temperature for generation (0.0 to 1.0) */
  temperature?: number;
  /** Top-p sampling parameter (0.0 to 1.0) */
  topP?: number;
  /** Maximum number of tokens to generate */
  maxTokens?: number;
  /** System prompt to use for all requests */
  systemPrompt?: string;
  /** Custom options to pass to Ollama */
  customOptions?: Record<string, unknown>;
}

/**
 * Default configuration for Ollama
 */
export const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  baseUrl: 'http://192.168.98.100:11434',
  defaultModel: 'qwen2.5-coder:32b',
  timeout: 120000, // 2 minutes
  maxRetries: 3,
  connectionTestEnabled: true,
  advancedOptions: {
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 4096,
    systemPrompt: '',
    customOptions: {},
  },
};

/**
 * Environment variable names for Ollama configuration
 */
export const OLLAMA_ENV_VARS = {
  BASE_URL: 'OLLAMA_BASE_URL',
  MODEL: 'OLLAMA_MODEL',
  TIMEOUT: 'OLLAMA_TIMEOUT',
  SKIP_CONNECTION_TEST: 'OLLAMA_SKIP_CONNECTION_TEST',
  TEMPERATURE: 'OLLAMA_TEMPERATURE',
  TOP_P: 'OLLAMA_TOP_P',
  MAX_TOKENS: 'OLLAMA_MAX_TOKENS',
} as const;

/**
 * Create Ollama configuration from environment variables
 */
export function createOllamaConfigFromEnv(): Partial<OllamaConfig> {
  const config: Partial<OllamaConfig> = {};

  const baseUrl = process.env[OLLAMA_ENV_VARS.BASE_URL];
  if (baseUrl) {
    config.baseUrl = baseUrl;
  }

  const model = process.env[OLLAMA_ENV_VARS.MODEL];
  if (model) {
    config.defaultModel = model;
  }

  const timeoutStr = process.env[OLLAMA_ENV_VARS.TIMEOUT];
  if (timeoutStr) {
    const timeout = parseInt(timeoutStr, 10);
    if (!isNaN(timeout)) {
      config.timeout = timeout;
    }
  }

  const skipConnectionTest = process.env[OLLAMA_ENV_VARS.SKIP_CONNECTION_TEST];
  if (skipConnectionTest) {
    config.connectionTestEnabled = skipConnectionTest !== 'true';
  }

  // Advanced options from environment
  const advancedOptions: Partial<OllamaAdvancedOptions> = {};

  const temperatureStr = process.env[OLLAMA_ENV_VARS.TEMPERATURE];
  if (temperatureStr) {
    const temperature = parseFloat(temperatureStr);
    if (!isNaN(temperature) && temperature >= 0 && temperature <= 1) {
      advancedOptions.temperature = temperature;
    }
  }

  const topPStr = process.env[OLLAMA_ENV_VARS.TOP_P];
  if (topPStr) {
    const topP = parseFloat(topPStr);
    if (!isNaN(topP) && topP >= 0 && topP <= 1) {
      advancedOptions.topP = topP;
    }
  }

  const maxTokensStr = process.env[OLLAMA_ENV_VARS.MAX_TOKENS];
  if (maxTokensStr) {
    const maxTokens = parseInt(maxTokensStr, 10);
    if (!isNaN(maxTokens) && maxTokens > 0) {
      advancedOptions.maxTokens = maxTokens;
    }
  }

  if (Object.keys(advancedOptions).length > 0) {
    config.advancedOptions = advancedOptions;
  }

  return config;
}

/**
 * Merge Ollama configurations with priority: provided > environment > defaults
 */
export function mergeOllamaConfig(
  provided?: Partial<OllamaConfig>,
  fromEnv?: Partial<OllamaConfig>,
): OllamaConfig {
  const envConfig = fromEnv || createOllamaConfigFromEnv();

  return {
    ...DEFAULT_OLLAMA_CONFIG,
    ...envConfig,
    ...provided,
    advancedOptions: {
      ...DEFAULT_OLLAMA_CONFIG.advancedOptions,
      ...envConfig.advancedOptions,
      ...provided?.advancedOptions,
    },
  };
}

/**
 * Validate Ollama configuration
 */
export function validateOllamaConfig(config: OllamaConfig): string[] {
  const errors: string[] = [];

  // Validate base URL
  try {
    new URL(config.baseUrl);
  } catch {
    errors.push(`Invalid base URL: ${config.baseUrl}`);
  }

  // Validate model name
  if (!config.defaultModel || config.defaultModel.trim().length === 0) {
    errors.push('Default model cannot be empty');
  }

  // Validate timeout
  if (config.timeout <= 0) {
    errors.push('Timeout must be greater than 0');
  }

  // Validate retries
  if (config.maxRetries < 0) {
    errors.push('Max retries cannot be negative');
  }

  // Validate advanced options
  if (config.advancedOptions) {
    const { temperature, topP, maxTokens } = config.advancedOptions;

    if (temperature !== undefined && (temperature < 0 || temperature > 1)) {
      errors.push('Temperature must be between 0 and 1');
    }

    if (topP !== undefined && (topP < 0 || topP > 1)) {
      errors.push('Top-p must be between 0 and 1');
    }

    if (maxTokens !== undefined && maxTokens <= 0) {
      errors.push('Max tokens must be greater than 0');
    }
  }

  return errors;
}
