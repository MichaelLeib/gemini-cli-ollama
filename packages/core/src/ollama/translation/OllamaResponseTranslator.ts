/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GenerateContentResponse, FinishReason, Tool } from '@google/genai';
import { OllamaChatResponse, OllamaToolCall } from '../ollamaClient.js';
import { ModelToolCapabilities, getModelCapabilities } from './ModelCapabilities.js';

/**
 * Statistics about response translation and validation
 */
export interface ResponseTranslationStats {
  totalToolCalls: number;
  validToolCalls: number;
  hallucinatedToolCalls: number;
  invalidJsonCalls: number;
  unknownToolCalls: number;
  warnings: string[];
}

/**
 * Translates Ollama responses back to Gemini format with validation
 */
export class OllamaResponseTranslator {
  /**
   * Validate and translate Ollama response to Gemini format
   */
  validateAndTranslateResponse(
    response: OllamaChatResponse, 
    modelName: string, 
    registeredTools: Tool[]
  ): { response: GenerateContentResponse, stats: ResponseTranslationStats } {
    const capabilities = getModelCapabilities(modelName);
    const stats: ResponseTranslationStats = {
      totalToolCalls: 0,
      validToolCalls: 0,
      hallucinatedToolCalls: 0,
      invalidJsonCalls: 0,
      unknownToolCalls: 0,
      warnings: []
    };
    
    // Clone response to avoid mutating original
    const validatedResponse = JSON.parse(JSON.stringify(response)) as OllamaChatResponse;
    
    // Validate and filter tool calls
    if (validatedResponse.message.tool_calls) {
      stats.totalToolCalls = validatedResponse.message.tool_calls.length;
      
      const validCalls = validatedResponse.message.tool_calls.filter(call => 
        this.isValidToolCall(call, capabilities, registeredTools, stats)
      );
      
      stats.validToolCalls = validCalls.length;
      stats.hallucinatedToolCalls = stats.totalToolCalls - stats.validToolCalls;
      
      // Update response with only valid calls
      validatedResponse.message.tool_calls = validCalls;
      
      // Log validation results
      if (stats.hallucinatedToolCalls > 0) {
        stats.warnings.push(`Filtered ${stats.hallucinatedToolCalls} hallucinated tool calls from ${modelName}`);
        console.warn(`Model ${modelName} hallucinated ${stats.hallucinatedToolCalls} tool calls`);
      }
    }
    
    const geminiResponse = this.convertToGeminiFormat(validatedResponse, capabilities, stats);
    
    return { response: geminiResponse, stats };
  }
  
  /**
   * Validate a single tool call
   */
  private isValidToolCall(
    toolCall: OllamaToolCall, 
    capabilities: ModelToolCapabilities, 
    registeredTools: Tool[],
    stats: ResponseTranslationStats
  ): boolean {
    // Check if tool name exists in registered tools
    const toolExists = this.findRegisteredTool(toolCall.function.name, registeredTools);
    if (!toolExists) {
      stats.unknownToolCalls++;
      stats.warnings.push(`Unknown tool called: ${toolCall.function.name}`);
      console.warn(`Model attempted to call non-existent tool: ${toolCall.function.name}`);
      return false;
    }
    
    // Validate JSON arguments
    if (!this.validateToolCallArguments(toolCall, stats)) {
      return false;
    }
    
    // Model-specific validation
    if (!this.validateForModelSpecificRequirements(toolCall, capabilities, stats)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Find a registered tool by name
   */
  private findRegisteredTool(toolName: string, registeredTools: Tool[]): Tool | null {
    for (const tool of registeredTools) {
      if ('functionDeclarations' in tool && tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          if (func.name === toolName) {
            return tool;
          }
        }
      }
    }
    return null;
  }
  
  /**
   * Validate tool call arguments are valid JSON
   */
  private validateToolCallArguments(toolCall: OllamaToolCall, stats: ResponseTranslationStats): boolean {
    try {
      if (typeof toolCall.function.arguments === 'string') {
        JSON.parse(toolCall.function.arguments);
      } else if (typeof toolCall.function.arguments === 'object') {
        // Already parsed, validate it's not null
        if (toolCall.function.arguments === null) {
          throw new Error('Arguments cannot be null');
        }
      } else {
        throw new Error(`Invalid arguments type: ${typeof toolCall.function.arguments}`);
      }
      return true;
    } catch (e) {
      stats.invalidJsonCalls++;
      const errorMessage = e instanceof Error ? e.message : String(e);
      stats.warnings.push(`Invalid JSON in tool call arguments for ${toolCall.function.name}: ${errorMessage}`);
      console.warn(`Invalid JSON in tool call arguments for ${toolCall.function.name}:`, e);
      return false;
    }
  }
  
  /**
   * Model-specific validation rules
   */
  private validateForModelSpecificRequirements(
    toolCall: OllamaToolCall, 
    capabilities: ModelToolCapabilities,
    stats: ResponseTranslationStats
  ): boolean {
    // Qwen-specific validation
    if (capabilities.customParser === 'qwen3coder') {
      // Qwen models sometimes add extra formatting
      if (toolCall.function.name.includes('<') || toolCall.function.name.includes('>')) {
        stats.warnings.push(`Qwen model used invalid formatting in tool name: ${toolCall.function.name}`);
        return false;
      }
    }
    
    // DeepSeek-specific validation  
    if (capabilities.multiTurnSupport === 'poor') {
      // DeepSeek models sometimes hallucinate follow-up calls
      // This is a heuristic check - in real implementation, we'd track conversation state
      if (toolCall.function.name.toLowerCase().includes('follow') || 
          toolCall.function.name.toLowerCase().includes('next')) {
        stats.warnings.push(`DeepSeek model may be hallucinating follow-up call: ${toolCall.function.name}`);
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Convert validated Ollama response to Gemini format
   */
  private convertToGeminiFormat(
    response: OllamaChatResponse, 
    capabilities: ModelToolCapabilities,
    stats: ResponseTranslationStats
  ): GenerateContentResponse {
    const out = new GenerateContentResponse();
    
    // Build parts array from content and tool calls  
    const parts: any[] = [];
    
    // Add text content if present
    if (response.message.content && response.message.content.trim()) {
      parts.push({ text: response.message.content });
    }
    
    // Convert valid tool calls to Gemini function calls
    if (response.message.tool_calls && response.message.tool_calls.length > 0) {
      for (const toolCall of response.message.tool_calls) {
        const functionCall = this.convertToolCallToFunctionCall(toolCall, capabilities);
        if (functionCall) {
          parts.push({ functionCall });
        }
      }
    }
    
    // Ensure we have at least some content
    if (parts.length === 0) {
      parts.push({ text: '' });
    }
    
    out.candidates = [
      {
        content: {
          parts: parts,
          role: 'model',
        },
        finishReason: response.done ? FinishReason.STOP : undefined,
        index: 0,
        safetyRatings: [],
      },
    ];
    
    out.usageMetadata = {
      promptTokenCount: response.prompt_eval_count || 0,
      candidatesTokenCount: response.eval_count || 0,
      totalTokenCount: (response.prompt_eval_count || 0) + (response.eval_count || 0),
    };
    
    out.modelVersion = response.model;
    
    return out;
  }
  
  /**
   * Convert Ollama tool call to Gemini function call
   */
  private convertToolCallToFunctionCall(toolCall: OllamaToolCall, capabilities: ModelToolCapabilities): any {
    try {
      let args = toolCall.function.arguments;
      
      // Parse string arguments to object
      if (typeof args === 'string') {
        args = JSON.parse(args);
      }
      
      // Model-specific argument processing
      if (capabilities.customParser === 'qwen3coder') {
        args = this.processQwenCoderArguments(args);
      }
      
      return {
        name: toolCall.function.name,
        args: args
      };
    } catch (e) {
      console.warn(`Failed to convert tool call to function call:`, e);
      return null;
    }
  }
  
  /**
   * Process arguments for Qwen Coder models
   */
  private processQwenCoderArguments(args: any): any {
    if (!args || typeof args !== 'object') {
      return args;
    }
    
    // Qwen sometimes wraps arguments in extra structures
    if (args.parameters && typeof args.parameters === 'object') {
      return args.parameters;
    }
    
    if (args.arguments && typeof args.arguments === 'object') {
      return args.arguments;
    }
    
    return args;
  }
  
  /**
   * Get model-specific response processing instructions
   */
  getModelResponseInstructions(modelName: string): string[] {
    const capabilities = getModelCapabilities(modelName);
    const instructions: string[] = [];
    
    if (capabilities.multiTurnSupport === 'poor') {
      instructions.push('Prefer single-turn tool calling over multi-turn conversations');
    }
    
    if (capabilities.customParser === 'qwen3coder') {
      instructions.push('Be aware of Qwen-specific argument wrapping');
    }
    
    if (!capabilities.supportsParallel) {
      instructions.push('Model does not support parallel tool calls');
    }
    
    return instructions;
  }
  
  /**
   * Check if response indicates model confusion or hallucination
   */
  detectResponseIssues(response: OllamaChatResponse, modelName: string): string[] {
    const issues: string[] = [];
    const capabilities = getModelCapabilities(modelName);
    
    // Check for common hallucination patterns
    if (response.message.content) {
      const content = response.message.content.toLowerCase();
      
      // Model is describing tools instead of using them
      if (content.includes('i need to call') || content.includes('i should use')) {
        issues.push('Model is describing tool usage instead of calling tools');
      }
      
      // Model is making up tool names
      if (content.includes('function_') || content.includes('tool_')) {
        issues.push('Model may be referencing non-existent tools');
      }
    }
    
    // Check for model-specific issues
    if (capabilities.multiTurnSupport === 'poor' && response.message.tool_calls) {
      if (response.message.tool_calls.length > 3) {
        issues.push('DeepSeek model making too many tool calls (may be hallucinating)');
      }
    }
    
    return issues;
  }
}