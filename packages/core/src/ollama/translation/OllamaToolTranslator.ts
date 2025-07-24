/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tool, FunctionDeclaration } from '@google/genai';
import { OllamaTool } from '../ollamaClient.js';
import { ModelToolCapabilities, getModelCapabilities } from './ModelCapabilities.js';

/**
 * Translates Gemini CLI tools to Ollama model-specific formats
 */
export class OllamaToolTranslator {
  /**
   * Translate Gemini tools to Ollama format for a specific model
   */
  translateGeminiToolsToOllama(tools: Tool[], modelName: string): OllamaTool[] {
    const capabilities = getModelCapabilities(modelName);
    
    if (!capabilities.supportsTools || tools.length === 0) {
      return []; // Return empty array if model doesn't support tools
    }
    
    // Limit tools to model's maximum
    const limitedTools = tools.slice(0, capabilities.maxTools);
    
    return limitedTools
      .map(tool => this.convertSingleTool(tool, capabilities))
      .filter(tool => tool !== null) as OllamaTool[];
  }
  
  /**
   * Convert a single Gemini tool to Ollama format
   */
  private convertSingleTool(tool: Tool, capabilities: ModelToolCapabilities): OllamaTool | null {
    // Extract function declarations from the tool
    if (!('functionDeclarations' in tool) || !tool.functionDeclarations) {
      console.warn(`Tool missing functionDeclarations:`, tool);
      return null;
    }
    
    // For now, take the first function declaration
    // TODO: Handle multiple function declarations per tool
    const functionDecl = tool.functionDeclarations[0];
    if (!functionDecl) {
      console.warn(`Tool has empty functionDeclarations:`, tool);
      return null;
    }
    
    switch (capabilities.toolFormat) {
      case 'openai':
        return this.convertToOpenAIFormat(functionDecl, capabilities);
      case 'hermes':
        return this.convertToHermesFormat(functionDecl, capabilities);
      case 'custom':
        return this.convertToCustomFormat(functionDecl, capabilities);
      default:
        console.warn(`Unknown tool format: ${capabilities.toolFormat}`);
        return null;
    }
  }
  
  /**
   * Convert to OpenAI-compatible format (used by Mistral, DeepSeek, K2, etc.)
   */
  private convertToOpenAIFormat(functionDecl: FunctionDeclaration, capabilities: ModelToolCapabilities): OllamaTool {
    return {
      type: 'function',
      function: {
        name: functionDecl.name ?? 'unnamed_function',
        description: this.sanitizeDescription(functionDecl.description ?? '', capabilities),
        parameters: this.convertParameters(functionDecl, capabilities)
      }
    };
  }
  
  /**
   * Convert to Hermes format (used by Qwen models)
   */
  private convertToHermesFormat(functionDecl: FunctionDeclaration, capabilities: ModelToolCapabilities): OllamaTool {
    const description = functionDecl.description ?? '';
    const enhancedDescription = `${description}\n\nUse this tool when you need to ${description.toLowerCase()}.`;
    
    return {
      type: 'function',
      function: {
        name: functionDecl.name ?? 'unnamed_function',
        description: this.sanitizeDescription(enhancedDescription, capabilities),
        parameters: this.convertParameters(functionDecl, capabilities)
      }
    };
  }
  
  /**
   * Convert to custom format (for models with special requirements)
   */
  private convertToCustomFormat(functionDecl: FunctionDeclaration, capabilities: ModelToolCapabilities): OllamaTool {
    switch (capabilities.customParser) {
      case 'qwen3coder':
        return this.convertToQwenCoderFormat(functionDecl, capabilities);
      default:
        // Fallback to OpenAI format
        return this.convertToOpenAIFormat(functionDecl, capabilities);
    }
  }
  
  /**
   * Convert to Qwen3 Coder specific format
   */
  private convertToQwenCoderFormat(functionDecl: FunctionDeclaration, capabilities: ModelToolCapabilities): OllamaTool {
    // Qwen3 Coder uses enhanced descriptions with explicit usage instructions
    const description = functionDecl.description ?? '';
    const coderDescription = `${description}

Usage: Call this function when you need to ${description.toLowerCase()}.
Think step by step before calling this function.`;
    
    return {
      type: 'function',
      function: {
        name: functionDecl.name ?? 'unnamed_function',
        description: this.sanitizeDescription(coderDescription, capabilities),
        parameters: this.convertParameters(functionDecl, capabilities)
      }
    };
  }
  
  /**
   * Convert function parameters to Ollama format
   */
  private convertParameters(functionDecl: FunctionDeclaration, capabilities: ModelToolCapabilities): any {
    if (!functionDecl.parameters) {
      return {
        type: 'object',
        properties: {},
        required: []
      };
    }
    
    const parameters = {
      type: 'object',
      properties: functionDecl.parameters.properties || {},
      required: functionDecl.parameters.required || []
    };
    
    // Model-specific parameter adjustments
    if (capabilities.toolFormat === 'hermes') {
      // Hermes format prefers more detailed parameter descriptions
      parameters.properties = this.enhanceParameterDescriptions(parameters.properties);
    }
    
    return parameters;
  }
  
  /**
   * Enhance parameter descriptions for better model understanding
   */
  private enhanceParameterDescriptions(properties: any): any {
    if (!properties || typeof properties !== 'object') {
      return properties;
    }
    
    const enhanced = { ...properties };
    
    for (const [key, value] of Object.entries(enhanced)) {
      if (value && typeof value === 'object' && 'description' in value) {
        const originalDesc = (value as any).description || '';
        if (originalDesc && !originalDesc.includes('Parameter:')) {
          (enhanced[key] as any).description = `Parameter: ${originalDesc}`;
        }
      }
    }
    
    return enhanced;
  }
  
  /**
   * Sanitize description for model compatibility
   */
  private sanitizeDescription(description: string, capabilities: ModelToolCapabilities): string {
    if (!description) {
      return 'No description provided';
    }
    
    // Remove potentially problematic characters/formatting
    let sanitized = description
      .replace(/[<>]/g, '') // Remove angle brackets that might confuse models
      .replace(/\n\s*\n/g, '\n') // Collapse multiple newlines
      .trim();
    
    // Model-specific sanitization
    if (capabilities.toolFormat === 'hermes') {
      // Hermes models prefer more explicit language
      if (!sanitized.toLowerCase().includes('function') && !sanitized.toLowerCase().includes('tool')) {
        sanitized = `Function to ${sanitized.toLowerCase()}`;
      }
    }
    
    // Limit description length for models with constraints
    const maxLength = capabilities.toolFormat === 'custom' ? 200 : 500;
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength - 3) + '...';
    }
    
    return sanitized;
  }
  
  /**
   * Validate that tools are compatible with model capabilities
   */
  validateToolsForModel(tools: Tool[], modelName: string): { valid: Tool[], invalid: Tool[], warnings: string[] } {
    const capabilities = getModelCapabilities(modelName);
    const warnings: string[] = [];
    const valid: Tool[] = [];
    const invalid: Tool[] = [];
    
    if (!capabilities.supportsTools) {
      warnings.push(`Model ${modelName} does not support tool calling`);
      return { valid: [], invalid: tools, warnings };
    }
    
    if (tools.length > capabilities.maxTools) {
      warnings.push(`Model ${modelName} supports max ${capabilities.maxTools} tools, got ${tools.length}. Truncating.`);
    }
    
    for (const tool of tools) {
      if ('functionDeclarations' in tool && tool.functionDeclarations && tool.functionDeclarations.length > 0) {
        valid.push(tool);
      } else {
        invalid.push(tool);
        warnings.push(`Tool missing valid functionDeclarations: ${JSON.stringify(tool)}`);
      }
    }
    
    return { valid, invalid, warnings };
  }
  
  /**
   * Get model-specific tool configuration
   */
  getToolConfigForModel(modelName: string): Record<string, unknown> {
    const capabilities = getModelCapabilities(modelName);
    const config: Record<string, unknown> = {};
    
    if (capabilities.config?.requiresExplicitToolChoice) {
      config.tool_choice = 'auto';
    }
    
    if (capabilities.supportsParallel) {
      config.parallel_tool_calls = true;
    }
    
    return config;
  }
}