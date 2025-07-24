/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OllamaConfig, DEFAULT_OLLAMA_CONFIG } from './ollamaConfig.js';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  serverInfo?: {
    version?: string;
    models?: string[];
  };
}

/**
 * Validates Ollama configuration with enhanced validation rules
 */
export function validateOllamaConfigEnhanced(config: Partial<OllamaConfig>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate base URL
  if (!config.baseUrl) {
    errors.push('Base URL is required');
  } else {
    try {
      const url = new URL(config.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        errors.push('Base URL must use HTTP or HTTPS protocol');
      }
      if (url.pathname !== '/' && url.pathname !== '') {
        warnings.push('Base URL should typically point to the root path');
      }
    } catch (_e) {
      errors.push('Base URL is not a valid URL');
    }
  }

  // Validate model name
  if (!config.defaultModel) {
    errors.push('Default model is required');
  } else {
    // Check for common model naming patterns
    const modelPattern = /^[a-zA-Z0-9_-]+(:[\w.-]+)?$/;
    if (!modelPattern.test(config.defaultModel)) {
      warnings.push('Model name may not follow standard naming conventions');
    }
  }

  // Validate timeout
  if (config.timeout !== undefined) {
    if (typeof config.timeout !== 'number' || config.timeout <= 0) {
      errors.push('Timeout must be a positive number');
    } else if (config.timeout < 5000) {
      warnings.push('Timeout below 5 seconds may cause connection issues');
    } else if (config.timeout > 300000) {
      warnings.push('Timeout above 5 minutes may be too long for most use cases');
    }
  }

  // Validate max retries
  if (config.maxRetries !== undefined) {
    if (typeof config.maxRetries !== 'number' || config.maxRetries < 0) {
      errors.push('Max retries must be a non-negative number');
    } else if (config.maxRetries > 10) {
      warnings.push('Max retries above 10 may cause long delays on failures');
    }
  }

  // Validate advanced options if present
  if (config.advancedOptions) {
    const adv = config.advancedOptions;

    // Validate temperature
    if (adv.temperature !== undefined) {
      if (typeof adv.temperature !== 'number' || adv.temperature < 0 || adv.temperature > 2) {
        errors.push('Temperature must be between 0 and 2');
      }
    }

    // Validate top_p
    if (adv.topP !== undefined) {
      if (typeof adv.topP !== 'number' || adv.topP < 0 || adv.topP > 1) {
        errors.push('Top P must be between 0 and 1');
      }
    }

    // Validate max tokens
    if (adv.maxTokens !== undefined) {
      if (typeof adv.maxTokens !== 'number' || adv.maxTokens <= 0) {
        errors.push('Max tokens must be a positive number');
      } else if (adv.maxTokens < 50) {
        warnings.push('Max tokens below 50 may be too small for most responses');
      } else if (adv.maxTokens > 100000) {
        warnings.push('Very large max token values may impact performance');
      }
    }

    // Validate system prompt
    if (adv.systemPrompt !== undefined) {
      if (typeof adv.systemPrompt !== 'string') {
        errors.push('System prompt must be a string');
      } else if (adv.systemPrompt.length > 10000) {
        warnings.push('Very long system prompts may impact performance');
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Tests connection to Ollama server
 */
export async function testOllamaConnection(config: OllamaConfig): Promise<ConnectionTestResult> {
  try {
    // Test basic connectivity
    const response = await fetch(`${config.baseUrl}/api/tags`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(config.timeout),
    });

    if (!response.ok) {
      return {
        success: false,
        message: `Server responded with status ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();
    const models = data.models?.map((m: {name: string}) => m.name) || [];

    // Test if the default model exists
    if (config.defaultModel && models.length > 0) {
      const modelExists = models.some((model: string) => 
        model === config.defaultModel || model.startsWith(`${config.defaultModel}:`)
      );
      
      if (!modelExists) {
        return {
          success: false,
          message: `Default model "${config.defaultModel}" not found on server. Available models: ${models.join(', ')}`,
          serverInfo: {
            models,
          },
        };
      }
    }

    return {
      success: true,
      message: `Successfully connected to Ollama server. Found ${models.length} models.`,
      serverInfo: {
        models,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TimeoutError') {
        return {
          success: false,
          message: `Connection timeout after ${config.timeout}ms. Check if Ollama server is running.`,
        };
      }
      if (error.message.includes('ECONNREFUSED')) {
        return {
          success: false,
          message: 'Connection refused. Check if Ollama server is running and accessible.',
        };
      }
      return {
        success: false,
        message: `Connection error: ${error.message}`,
      };
    }
    return {
      success: false,
      message: 'Unknown connection error occurred',
    };
  }
}

/**
 * Validates configuration and tests connection
 */
export async function validateAndTestOllamaConfig(config: Partial<OllamaConfig>): Promise<{
  validation: ValidationResult;
  connectionTest?: ConnectionTestResult;
}> {
  const validation = validateOllamaConfigEnhanced(config);
  
  if (!validation.isValid) {
    return { validation };
  }

  // Only test connection if validation passes
  const fullConfig = { ...DEFAULT_OLLAMA_CONFIG, ...config } as OllamaConfig;
  const connectionTest = await testOllamaConnection(fullConfig);

  return {
    validation,
    connectionTest,
  };
}

/**
 * Sanitizes configuration by removing invalid values and applying defaults
 */
export function sanitizeOllamaConfig(config: Partial<OllamaConfig>): OllamaConfig {
  const sanitized = { ...DEFAULT_OLLAMA_CONFIG };

  // Sanitize base URL
  if (config.baseUrl && typeof config.baseUrl === 'string') {
    try {
      const url = new URL(config.baseUrl);
      if (['http:', 'https:'].includes(url.protocol)) {
        sanitized.baseUrl = config.baseUrl.replace(/\/+$/, ''); // Remove trailing slashes
      }
    } catch {
      // Keep default if invalid
    }
  }

  // Sanitize model name
  if (config.defaultModel && typeof config.defaultModel === 'string' && config.defaultModel.trim()) {
    sanitized.defaultModel = config.defaultModel.trim();
  }

  // Sanitize timeout
  if (typeof config.timeout === 'number' && config.timeout > 0) {
    sanitized.timeout = Math.min(Math.max(config.timeout, 1000), 600000); // Clamp between 1s and 10min
  }

  // Sanitize max retries
  if (typeof config.maxRetries === 'number' && config.maxRetries >= 0) {
    sanitized.maxRetries = Math.min(config.maxRetries, 20); // Max 20 retries
  }

  // Sanitize connection test enabled
  if (typeof config.connectionTestEnabled === 'boolean') {
    sanitized.connectionTestEnabled = config.connectionTestEnabled;
  }

  // Sanitize advanced options
  if (config.advancedOptions && typeof config.advancedOptions === 'object') {
    const advOptions = config.advancedOptions;
    sanitized.advancedOptions = {};

    // Sanitize temperature
    if (typeof advOptions.temperature === 'number') {
      sanitized.advancedOptions.temperature = Math.min(Math.max(advOptions.temperature, 0), 2);
    }

    // Sanitize top_p
    if (typeof advOptions.topP === 'number') {
      sanitized.advancedOptions.topP = Math.min(Math.max(advOptions.topP, 0), 1);
    }

    // Sanitize max tokens
    if (typeof advOptions.maxTokens === 'number' && advOptions.maxTokens > 0) {
      sanitized.advancedOptions.maxTokens = Math.min(Math.max(advOptions.maxTokens, 1), 100000);
    }

    // Sanitize system prompt
    if (typeof advOptions.systemPrompt === 'string') {
      sanitized.advancedOptions.systemPrompt = advOptions.systemPrompt.substring(0, 10000);
    }

    // Copy custom options
    if (advOptions.customOptions && typeof advOptions.customOptions === 'object') {
      sanitized.advancedOptions.customOptions = { ...advOptions.customOptions };
    }
  }

  return sanitized;
}