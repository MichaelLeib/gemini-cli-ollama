/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GenerateContentParameters,
  GenerateContentResponse,
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
} from '@google/genai';
import { ContentGenerator } from '../core/contentGenerator.js';
import { OllamaClient } from './ollamaClient.js';
import { OllamaConverter } from './ollamaConverter.js';
import { OllamaConfig } from '../config/ollamaConfig.js';

/**
 * Content generator implementation for Ollama
 */
export class OllamaContentGenerator implements ContentGenerator {
  readonly userTier: undefined = undefined; // Ollama doesn't have user tiers

  constructor(
    private readonly client: OllamaClient,
    private readonly config: OllamaConfig
  ) {}

  /**
   * Generate content using Ollama
   */
  async generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse> {
    // Validate request compatibility
    const validationErrors = OllamaConverter.validateRequest(request);
    if (validationErrors.length > 0) {
      console.warn('Ollama compatibility issues detected:');
      validationErrors.forEach(error => console.warn(`  - ${error}`));
    }

    // Sanitize request for Ollama compatibility
    const sanitizedRequest = OllamaConverter.sanitizeRequest(request);

    try {
      return await this.client.generateContent(sanitizedRequest);
    } catch (error) {
      throw this.enhanceError(error, 'generateContent');
    }
  }

  /**
   * Generate content with streaming using Ollama
   */
  async generateContentStream(
    request: GenerateContentParameters
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    // Validate request compatibility
    const validationErrors = OllamaConverter.validateRequest(request);
    if (validationErrors.length > 0) {
      console.warn('Ollama compatibility issues detected:');
      validationErrors.forEach(error => console.warn(`  - ${error}`));
    }

    // Sanitize request for Ollama compatibility
    const sanitizedRequest = OllamaConverter.sanitizeRequest(request);

    try {
      return this.client.generateContentStream(sanitizedRequest);
    } catch (error) {
      throw this.enhanceError(error, 'generateContentStream');
    }
  }

  /**
   * Count tokens using Ollama's estimation
   */
  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    try {
      return await this.client.countTokens(request);
    } catch (error) {
      throw this.enhanceError(error, 'countTokens');
    }
  }

  /**
   * Embed content - not supported by Ollama
   */
  async embedContent(_request: EmbedContentParameters): Promise<EmbedContentResponse> {
    throw new Error(
      'Embedding is not supported by Ollama. ' +
      'Please use a different authentication method (Google API, Vertex AI) for embedding operations, ' +
      'or use a dedicated embedding service.'
    );
  }

  /**
   * Get available models from Ollama
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const models = await this.client.listModels();
      return models.map(model => model.name);
    } catch (error) {
      throw this.enhanceError(error, 'getAvailableModels');
    }
  }

  /**
   * Check if Ollama server is accessible
   */
  async testConnection(): Promise<boolean> {
    return await this.client.testConnection();
  }

  /**
   * Check if the current model is available
   */
  async isCurrentModelAvailable(): Promise<boolean> {
    return await this.client.isModelAvailable(this.config.defaultModel);
  }

  /**
   * Get current configuration
   */
  getConfig(): OllamaConfig {
    return this.config;
  }

  /**
   * Enhance error messages with Ollama-specific context
   */
  private enhanceError(error: unknown, operation: string): Error {
    const baseMessage = error instanceof Error ? error.message : String(error);
    
    // Connection errors
    if (baseMessage.includes('fetch') || baseMessage.includes('ECONNREFUSED')) {
      return new Error(
        `Failed to connect to Ollama server at ${this.config.baseUrl}. ` +
        `Please ensure Ollama is running and accessible. ` +
        `Original error: ${baseMessage}`
      );
    }
    
    // Model not found errors
    if (baseMessage.includes('model') && baseMessage.includes('not found')) {
      return new Error(
        `Model "${this.config.defaultModel}" not found on Ollama server. ` +
        `Please check if the model is available or pull it using 'ollama pull ${this.config.defaultModel}'. ` +
        `Original error: ${baseMessage}`
      );
    }
    
    // Timeout errors
    if (baseMessage.includes('timeout') || baseMessage.includes('AbortError')) {
      return new Error(
        `Ollama request timed out after ${this.config.timeout}ms. ` +
        `Consider increasing the timeout in your Ollama configuration. ` +
        `Original error: ${baseMessage}`
      );
    }
    
    // Generic error enhancement
    return new Error(
      `Ollama ${operation} failed: ${baseMessage}. ` +
      `Server: ${this.config.baseUrl}, Model: ${this.config.defaultModel}`
    );
  }
}

/**
 * Factory function to create OllamaContentGenerator
 */
export function createOllamaContentGenerator(config: OllamaConfig): OllamaContentGenerator {
  const client = new OllamaClient(config);
  return new OllamaContentGenerator(client, config);
}

/**
 * Utility function to validate Ollama configuration and connectivity
 */
export async function validateOllamaSetup(config: OllamaConfig): Promise<{
  isValid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Validate configuration
  try {
    const configErrors = [];
    
    // Basic URL validation
    try {
      new URL(config.baseUrl);
    } catch {
      configErrors.push(`Invalid base URL: ${config.baseUrl}`);
    }
    
    // Model name validation
    if (!config.defaultModel || config.defaultModel.trim().length === 0) {
      configErrors.push('Default model cannot be empty');
    }
    
    errors.push(...configErrors);
    
    if (configErrors.length > 0) {
      return { isValid: false, errors, warnings };
    }
  } catch (error) {
    errors.push(`Configuration validation failed: ${error}`);
    return { isValid: false, errors, warnings };
  }
  
  // Test connectivity if enabled
  if (config.connectionTestEnabled) {
    try {
      const client = new OllamaClient(config);
      const isConnected = await client.testConnection();
      
      if (!isConnected) {
        errors.push('Failed to connect to Ollama server');
        return { isValid: false, errors, warnings };
      }
      
      // Check if default model is available
      const isModelAvailable = await client.isModelAvailable(config.defaultModel);
      if (!isModelAvailable) {
        errors.push(
          `Model "${config.defaultModel}" is not available on the Ollama server. ` +
          `Please pull the model using: ollama pull ${config.defaultModel}`
        );
        return { isValid: false, errors, warnings };
      }
      
    } catch (error) {
      errors.push(`Connection test failed: ${error}`);
      return { isValid: false, errors, warnings };
    }
  } else {
    warnings.push('Connection testing is disabled');
  }
  
  // Performance warnings
  if (config.timeout < 30000) {
    warnings.push('Timeout is set to less than 30 seconds, which may cause issues with larger models');
  }
  
  if (config.maxRetries > 5) {
    warnings.push('Max retries is set higher than 5, which may cause long delays on failures');
  }
  
  return { isValid: true, errors, warnings };
}