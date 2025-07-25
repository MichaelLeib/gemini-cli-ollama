/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tool, GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { OllamaChatRequest, OllamaChatResponse, OllamaTool } from '../ollamaClient.js';
import { ModelToolCapabilities, getModelCapabilities, modelSupportsTools, getModelRecommendedTimeout } from './ModelCapabilities.js';
import { OllamaToolTranslator } from './OllamaToolTranslator.js';
import { OllamaResponseTranslator, ResponseTranslationStats } from './OllamaResponseTranslator.js';
import { ModelPromptEngineer } from './ModelPromptEngineer.js';

/**
 * Result of tool translation and validation
 */
export interface ToolTranslationResult {
  tools: OllamaTool[];
  warnings: string[];
  modelSupportsTools: boolean;
  capabilities: ModelToolCapabilities;
}

/**
 * Result of request translation
 */
export interface RequestTranslationResult {
  request: Partial<OllamaChatRequest>;
  enhancedSystemPrompt: string | null;
  warnings: string[];
}

/**
 * Result of response translation
 */
export interface ResponseTranslationResult {
  response: GenerateContentResponse;
  stats: ResponseTranslationStats;
  modelIssues: string[];
}

/**
 * Main service that orchestrates tool calling translation between Gemini CLI and Ollama models
 */
export class OllamaToolTranslationService {
  private toolTranslator: OllamaToolTranslator;
  private responseTranslator: OllamaResponseTranslator;
  private promptEngineer: ModelPromptEngineer;
  
  constructor() {
    this.toolTranslator = new OllamaToolTranslator();
    this.responseTranslator = new OllamaResponseTranslator();
    this.promptEngineer = new ModelPromptEngineer();
  }
  
  /**
   * Detect model capabilities for tool calling
   */
  detectModelCapabilities(modelName: string): ModelToolCapabilities {
    return getModelCapabilities(modelName);
  }
  
  /**
   * Translate Gemini tools to model-specific format
   */
  translateToolsToModel(tools: Tool[], modelName: string): ToolTranslationResult {
    const capabilities = getModelCapabilities(modelName);
    const warnings: string[] = [];
    
    // Check if model supports tools at all
    if (!modelSupportsTools(modelName)) {
      warnings.push(`Model ${modelName} does not support tool calling`);
      return {
        tools: [],
        warnings,
        modelSupportsTools: false,
        capabilities
      };
    }
    
    // Validate tools for this model
    const validation = this.toolTranslator.validateToolsForModel(tools, modelName);
    warnings.push(...validation.warnings);
    
    // Translate valid tools
    const translatedTools = this.toolTranslator.translateGeminiToolsToOllama(validation.valid, modelName);
    
    return {
      tools: translatedTools,
      warnings,
      modelSupportsTools: true,
      capabilities
    };
  }
  
  /**
   * Translate Gemini request to Ollama format with enhanced prompting
   */
  translateRequestToModel(
    request: GenerateContentParameters, 
    modelName: string, 
    availableTools: Tool[]
  ): RequestTranslationResult {
    const capabilities = getModelCapabilities(modelName);
    const warnings: string[] = [];
    
    // Translate tools
    const toolTranslation = this.translateToolsToModel(availableTools, modelName);
    warnings.push(...toolTranslation.warnings);
    
    // Enhanced system prompt
    let enhancedSystemPrompt: string | null = null;
    if (request.config?.systemInstruction) {
      const basePrompt = typeof request.config.systemInstruction === 'string' 
        ? request.config.systemInstruction
        : this.extractTextFromContent(request.config.systemInstruction);
        
      enhancedSystemPrompt = this.promptEngineer.enhanceSystemPrompt(
        basePrompt, 
        modelName, 
        availableTools
      );
    }
    
    // Get model-specific tool configuration
    const toolConfig = this.toolTranslator.getToolConfigForModel(modelName);
    
    // Build request modifications
    const requestModifications: Partial<OllamaChatRequest> = {};
    
    if (toolTranslation.tools.length > 0) {
      requestModifications.tools = toolTranslation.tools;
      
      // Add tool-specific options
      if (toolConfig && Object.keys(toolConfig).length > 0) {
        requestModifications.options = {
          ...requestModifications.options,
          ...toolConfig
        };
      }
    }
    
    return {
      request: requestModifications,
      enhancedSystemPrompt,
      warnings
    };
  }
  
  /**
   * Translate and validate Ollama response back to Gemini format
   */
  translateResponseFromModel(
    response: OllamaChatResponse, 
    modelName: string, 
    registeredTools: Tool[]
  ): ResponseTranslationResult {
    // Detect potential model issues
    const modelIssues = this.responseTranslator.detectResponseIssues(response, modelName);
    
    // Translate and validate response
    const { response: geminiResponse, stats } = this.responseTranslator.validateAndTranslateResponse(
      response, 
      modelName, 
      registeredTools
    );
    
    return {
      response: geminiResponse,
      stats,
      modelIssues
    };
  }
  
  /**
   * Validate that a tool call is legitimate and not hallucinated
   */
  validateToolCall(toolCall: any, modelName: string, registeredTools: Tool[]): boolean {
    if (!toolCall || !toolCall.function || !toolCall.function.name) {
      return false;
    }
    
    // Check if tool exists in registered tools
    for (const tool of registeredTools) {
      if ('functionDeclarations' in tool && tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          if (func.name === toolCall.function.name) {
            return true;
          }
        }
      }
    }
    
    return false;
  }
  
  /**
   * Generate model-specific guidance for tool usage
   */
  generateToolUsageGuidance(modelName: string, availableTools: Tool[], taskContext?: string): string {
    const capabilities = getModelCapabilities(modelName);
    
    if (!capabilities.supportsTools || availableTools.length === 0) {
      return 'This model does not support tool calling.';
    }
    
    let guidance = `## Tool Usage for ${modelName}\n\n`;
    
    // Model capabilities summary
    guidance += `**Capabilities:**\n`;
    guidance += `- Max tools: ${capabilities.maxTools}\n`;
    guidance += `- Parallel calls: ${capabilities.supportsParallel ? 'Yes' : 'No'}\n`;
    guidance += `- Streaming: ${capabilities.supportsStreaming ? 'Yes' : 'No'}\n`;
    guidance += `- Multi-turn support: ${capabilities.multiTurnSupport}\n\n`;
    
    // Model-specific instructions
    const instructions = this.responseTranslator.getModelResponseInstructions(modelName);
    if (instructions.length > 0) {
      guidance += `**Important Notes:**\n`;
      instructions.forEach(instruction => {
        guidance += `- ${instruction}\n`;
      });
      guidance += '\n';
    }
    
    // Task-specific guidance
    if (taskContext) {
      const taskGuidance = this.promptEngineer.generateToolSelectionGuidance(
        availableTools, 
        taskContext, 
        modelName
      );
      guidance += taskGuidance;
    }
    
    return guidance;
  }
  
  /**
   * Get comprehensive model analysis for debugging
   */
  analyzeModelForToolCalling(modelName: string): {
    capabilities: ModelToolCapabilities;
    recommendations: string[];
    limitations: string[];
    bestPractices: string[];
  } {
    const capabilities = getModelCapabilities(modelName);
    const recommendations: string[] = [];
    const limitations: string[] = [];
    const bestPractices: string[] = [];
    
    // Analyze capabilities and generate recommendations
    if (!capabilities.supportsTools) {
      limitations.push('Model does not support tool calling');
      recommendations.push('Consider using a model with tool calling support');
    } else {
      // Positive recommendations
      if (capabilities.maxTools >= 32) {
        recommendations.push('Model supports a good number of tools');
      } else {
        limitations.push(`Limited to ${capabilities.maxTools} tools`);
        recommendations.push('Prioritize most essential tools');
      }
      
      if (capabilities.supportsParallel) {
        bestPractices.push('Can execute multiple tools simultaneously');
      } else {
        limitations.push('No parallel tool execution');
        bestPractices.push('Design sequential tool workflows');
      }
      
      if (capabilities.multiTurnSupport === 'poor') {
        limitations.push('Poor multi-turn tool calling support');
        bestPractices.push('Complete tasks in single comprehensive responses');
      }
      
      // Model-specific recommendations
      switch (capabilities.promptStyle) {
        case 'hermes':
          bestPractices.push('Use clear step-by-step reasoning before tool calls');
          break;
        case 'agentic':
          bestPractices.push('Leverage autonomous task orchestration capabilities');
          break;
        case 'standard':
          bestPractices.push('Use standard function calling patterns');
          break;
      }
    }
    
    return {
      capabilities,
      recommendations,
      limitations,
      bestPractices
    };
  }
  
  /**
   * Extract text content from various content formats
   */
  private extractTextFromContent(content: any): string {
    if (typeof content === 'string') {
      return content;
    }
    
    if (content && 'parts' in content && content.parts) {
      return content.parts
        .filter((part: any) => typeof part === 'string' || 'text' in part)
        .map((part: any) => typeof part === 'string' ? part : part.text || '')
        .join('\n');
    }
    
    return '';
  }
  
  /**
   * Get recommended timeout for a model
   */
  getRecommendedTimeout(modelName: string): number {
    return getModelRecommendedTimeout(modelName);
  }

  /**
   * Get recommended configuration for optimal tool calling with a model
   */
  getRecommendedConfiguration(modelName: string): Record<string, unknown> {
    const capabilities = getModelCapabilities(modelName);
    const config: Record<string, unknown> = {};
    
    // Context size recommendations
    if (capabilities.config?.recommendedContextSize) {
      config.num_ctx = capabilities.config.recommendedContextSize;
    }
    
    // Tool choice settings
    if (capabilities.config?.requiresExplicitToolChoice) {
      config.tool_choice = 'auto';
    }
    
    // Parallel calling settings
    if (capabilities.supportsParallel) {
      config.parallel_tool_calls = true;
    }
    
    // Temperature adjustments for better tool calling
    if (capabilities.toolFormat === 'hermes') {
      config.temperature = 0.1; // Lower temperature for more consistent tool calling
    }
    
    // Timeout recommendations
    if (capabilities.config?.recommendedTimeout) {
      config.timeout = capabilities.config.recommendedTimeout;
    }
    
    return config;
  }
}