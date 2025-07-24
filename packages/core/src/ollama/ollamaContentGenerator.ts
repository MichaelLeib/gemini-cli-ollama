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
  Tool,
} from '@google/genai';
import { ContentGenerator } from '../core/contentGenerator.js';
import { OllamaClient } from './ollamaClient.js';
import { OllamaConverter } from './ollamaConverter.js';
import { OllamaConfig } from '../config/ollamaConfig.js';
import { OllamaToolTranslationService } from './translation/OllamaToolTranslationService.js';

/**
 * Content generator implementation for Ollama
 */
export class OllamaContentGenerator implements ContentGenerator {
  readonly userTier: undefined = undefined; // Ollama doesn't have user tiers
  private readonly translationService: OllamaToolTranslationService;
  private registeredTools: Tool[] = [];

  constructor(
    private readonly client: OllamaClient,
    private readonly config: OllamaConfig
  ) {
    this.translationService = new OllamaToolTranslationService();
  }
  
  /**
   * Set the available tools for this content generator
   */
  setAvailableTools(tools: Tool[]): void {
    this.registeredTools = tools;
  }

  /**
   * Generate content using Ollama
   */
  async generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse> {
    const modelName = this.config.defaultModel;
    
    // Use translation service for model-aware tool handling
    const requestTranslation = this.translationService.translateRequestToModel(
      request, 
      modelName, 
      this.registeredTools
    );
    
    // Log any translation warnings
    if (requestTranslation.warnings.length > 0) {
      console.warn('Tool translation warnings:');
      requestTranslation.warnings.forEach(warning => console.warn(`  - ${warning}`));
    }
    
    // Create enhanced request with translated tools
    const enhancedRequest = { ...request };
    if (requestTranslation.enhancedSystemPrompt) {
      enhancedRequest.config = {
        ...enhancedRequest.config,
        systemInstruction: requestTranslation.enhancedSystemPrompt
      };
    }
    
    // Fallback to old validation for non-tool features
    const validationErrors = OllamaConverter.validateRequest(enhancedRequest);
    if (validationErrors.length > 0) {
      console.warn('Ollama compatibility issues detected:');
      validationErrors.forEach(error => console.warn(`  - ${error}`));
    }

    // Sanitize request for Ollama compatibility
    const sanitizedRequest = OllamaConverter.sanitizeRequest(enhancedRequest);

    try {
      const ollamaResponse = await this.client.generateContent(
        sanitizedRequest, 
        requestTranslation.request.tools
      );
      
      // Use translation service to validate and convert response
      const responseTranslation = this.translationService.translateResponseFromModel(
        ollamaResponse as any, // Cast needed due to response format differences
        modelName,
        this.registeredTools
      );
      
      // Log translation stats
      if (responseTranslation.stats.hallucinatedToolCalls > 0) {
        console.warn(`Filtered ${responseTranslation.stats.hallucinatedToolCalls} hallucinated tool calls`);
      }
      
      if (responseTranslation.modelIssues.length > 0) {
        console.warn('Model issues detected:', responseTranslation.modelIssues);
      }
      
      return responseTranslation.response;
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
    const modelName = this.config.defaultModel;
    
    // Use translation service for model-aware tool handling
    const requestTranslation = this.translationService.translateRequestToModel(
      request, 
      modelName, 
      this.registeredTools
    );
    
    // Log any translation warnings
    if (requestTranslation.warnings.length > 0) {
      console.warn('Tool translation warnings:');
      requestTranslation.warnings.forEach(warning => console.warn(`  - ${warning}`));
    }
    
    // Create enhanced request with translated tools
    const enhancedRequest = { ...request };
    if (requestTranslation.enhancedSystemPrompt) {
      enhancedRequest.config = {
        ...enhancedRequest.config,
        systemInstruction: requestTranslation.enhancedSystemPrompt
      };
    }
    
    // Fallback to old validation for non-tool features
    const validationErrors = OllamaConverter.validateRequest(enhancedRequest);
    if (validationErrors.length > 0) {
      console.warn('Ollama compatibility issues detected:');
      validationErrors.forEach(error => console.warn(`  - ${error}`));
    }

    // Sanitize request for Ollama compatibility
    const sanitizedRequest = OllamaConverter.sanitizeRequest(enhancedRequest);

    try {
      const ollamaStreamGenerator = await this.client.generateContentStream(
        sanitizedRequest,
        requestTranslation.request.tools
      );
      
      // Return a generator that translates each streaming response
      return this.translateStreamingResponses(ollamaStreamGenerator, modelName);
    } catch (error) {
      throw this.enhanceError(error, 'generateContentStream');
    }
  }
  
  /**
   * Translate streaming responses using the translation service
   */
  private async* translateStreamingResponses(
    ollamaGenerator: AsyncGenerator<GenerateContentResponse>, 
    modelName: string
  ): AsyncGenerator<GenerateContentResponse> {
    for await (const ollamaResponse of ollamaGenerator) {
      try {
        // Use translation service to validate and convert response
        const responseTranslation = this.translationService.translateResponseFromModel(
          ollamaResponse as any,
          modelName,
          this.registeredTools
        );
        
        // Log issues for debugging but don't interrupt streaming
        if (responseTranslation.stats.hallucinatedToolCalls > 0) {
          console.warn(`Streaming: Filtered ${responseTranslation.stats.hallucinatedToolCalls} hallucinated tool calls`);
        }
        
        yield responseTranslation.response;
      } catch (error) {
        console.warn('Error translating streaming response:', error);
        // Fallback to original response if translation fails
        yield ollamaResponse;
      }
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
export async function createOllamaContentGenerator(config: OllamaConfig, gcConfig?: any): Promise<OllamaContentGenerator> {
  const client = new OllamaClient(config);
  const generator = new OllamaContentGenerator(client, config);
  
  // Set available tools if gcConfig is provided
  if (gcConfig && gcConfig.getToolRegistry) {
    try {
      const toolRegistry = await gcConfig.getToolRegistry();
      const tools = toolRegistry.getTools();
      generator.setAvailableTools(tools);
    } catch (error) {
      console.warn('Failed to load tools for Ollama content generator:', error);
    }
  }
  
  return generator;
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