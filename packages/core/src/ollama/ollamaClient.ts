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
  FinishReason,
} from '@google/genai';
import { OllamaConfig } from '../config/ollamaConfig.js';

/**
 * Ollama tool definition (OpenAI-compatible format)
 */
export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/**
 * Ollama API request format for chat completions
 */
export interface OllamaChatRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  stream?: boolean;
  tools?: OllamaTool[];
  options?: {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    [key: string]: unknown;
  };
}

/**
 * Ollama tool call in response
 */
export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

/**
 * Ollama API response format for chat completions
 */
export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: 'assistant';
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * Ollama streaming response format
 */
export interface OllamaStreamResponse extends OllamaChatResponse {
  done_reason?: string;
}

/**
 * Ollama model information
 */
export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

/**
 * Ollama models list response
 */
export interface OllamaModelsResponse {
  models: OllamaModel[];
}

/**
 * HTTP client for communicating with Ollama server
 */
export class OllamaClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(private readonly config: OllamaConfig) {
    this.baseUrl = config.baseUrl.endsWith('/') 
      ? config.baseUrl.slice(0, -1) 
      : config.baseUrl;
    this.timeout = config.timeout;
    this.maxRetries = config.maxRetries;
  }

  /**
   * Generate content using Ollama chat API
   */
  async generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse> {
    const ollamaRequest = this.convertToOllamaRequest(request, false);
    
    const response = await this.makeRequest<OllamaChatResponse>(
      '/api/chat',
      ollamaRequest
    );

    return this.convertFromOllamaResponse(response);
  }

  /**
   * Generate content with streaming using Ollama chat API
   */
  async *generateContentStream(
    request: GenerateContentParameters
  ): AsyncGenerator<GenerateContentResponse> {
    const ollamaRequest = this.convertToOllamaRequest(request, true);
    
    const response = await this.makeStreamingRequest(
      '/api/chat',
      ollamaRequest
    );

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response stream reader');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const streamResponse: OllamaStreamResponse = JSON.parse(line);
              const geminiResponse = this.convertFromOllamaResponse(streamResponse);
              yield geminiResponse;
              
              if (streamResponse.done) {
                return;
              }
            } catch (error) {
              console.warn('Failed to parse streaming response line:', line, error);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Count tokens (placeholder implementation)
   * Ollama doesn't have a direct token counting API, so we estimate
   */
  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    // Rough estimation: ~4 characters per token for most models
    const text = JSON.stringify(request);
    const estimatedTokens = Math.ceil(text.length / 4);
    
    return {
      totalTokens: estimatedTokens,
    };
  }

  /**
   * Embed content (not supported by Ollama)
   */
  async embedContent(_request: EmbedContentParameters): Promise<EmbedContentResponse> {
    throw new Error('Embedding is not supported by Ollama. Use a different model or provider for embedding operations.');
  }

  /**
   * List available models from Ollama server
   */
  async listModels(): Promise<OllamaModel[]> {
    const response = await this.makeRequest<OllamaModelsResponse>(
      '/api/tags',
      null,
      'GET'
    );
    
    return response.models;
  }

  /**
   * Test connection to Ollama server
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch (error) {
      console.warn('Ollama connection test failed:', error);
      return false;
    }
  }

  /**
   * Check if a specific model is available
   */
  async isModelAvailable(modelName: string): Promise<boolean> {
    try {
      const models = await this.listModels();
      return models.some(model => 
        model.name === modelName || 
        model.model === modelName ||
        model.name.includes(modelName)
      );
    } catch (error) {
      console.warn('Failed to check model availability:', error);
      return false;
    }
  }

  /**
   * Convert Gemini request format to Ollama format
   */
  private convertToOllamaRequest(
    request: GenerateContentParameters, 
    stream: boolean
  ): OllamaChatRequest {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    
    // Add system instruction if present in config
    if (request.config?.systemInstruction) {
      const systemInstruction = request.config.systemInstruction;
      let systemContent = '';
      
      if (typeof systemInstruction === 'string') {
        systemContent = systemInstruction;
      } else if ('parts' in systemInstruction && systemInstruction.parts) {
        systemContent = systemInstruction.parts
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((part: any) => typeof part === 'string' || ('text' in part))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((part: any) => typeof part === 'string' ? part : ('text' in part ? part.text : ''))
          .join('\n');
      }
      
      if (systemContent) {
        messages.push({
          role: 'system',
          content: systemContent
        });
      }
    }
    
    // Convert contents to messages
    if (request.contents) {
      // Handle ContentListUnion (can be Content[], string, or PartUnion[])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let contents: any[] = [];
      
      if (typeof request.contents === 'string') {
        contents = [{ role: 'user', parts: [{ text: request.contents }] }];
      } else if (Array.isArray(request.contents)) {
        // Check if it's Content[] or PartUnion[]
        if (request.contents.length > 0 && typeof request.contents[0] === 'object' && 'role' in request.contents[0]) {
          // It's Content[]
          contents = request.contents;
        } else {
          // It's PartUnion[], wrap in a single Content
          contents = [{ role: 'user', parts: request.contents }];
        }
      }
      
      for (const content of contents) {
        if ('parts' in content && content.parts) {
          const textParts = content.parts
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((part: any) => typeof part === 'string' || ('text' in part))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((part: any) => typeof part === 'string' ? part : ('text' in part ? part.text : ''))
            .join('\n');
          
          if (textParts) {
            messages.push({
              role: (content.role === 'model' || content.role === 'assistant') ? 'assistant' : 'user',
              content: textParts
            });
          }
        }
      }
    }
    
    // Build options from generation config and advanced options
    const options: Record<string, unknown> = {};
    
    if (request.config) {
      if (request.config.temperature !== undefined) {
        options.temperature = request.config.temperature;
      }
      if (request.config.topP !== undefined) {
        options.top_p = request.config.topP;
      }
      if (request.config.maxOutputTokens !== undefined) {
        options.max_tokens = request.config.maxOutputTokens;
      }
    }
    
    // Add advanced options from config
    if (this.config.advancedOptions) {
      const advancedOptions = this.config.advancedOptions;
      if (advancedOptions.temperature !== undefined && !options.temperature) {
        options.temperature = advancedOptions.temperature;
      }
      if (advancedOptions.topP !== undefined && !options.top_p) {
        options.top_p = advancedOptions.topP;
      }
      if (advancedOptions.maxTokens !== undefined && !options.max_tokens) {
        options.max_tokens = advancedOptions.maxTokens;
      }
      if (advancedOptions.customOptions) {
        Object.assign(options, advancedOptions.customOptions);
      }
    }

    // Convert Gemini tools to Ollama format
    let tools: OllamaTool[] | undefined;
    if (request.config?.tools && request.config.tools.length > 0) {
      tools = [];
      for (const tool of request.config.tools) {
        if ('functionDeclarations' in tool && tool.functionDeclarations) {
          for (const func of tool.functionDeclarations) {
            tools.push({
              type: 'function',
              function: {
                name: func.name ?? '',
                description: func.description ?? '',
                parameters: {
                  type: 'object',
                  properties: func.parameters?.properties || {},
                  required: func.parameters?.required || []
                }
              }
            });
          }
        }
      }
    }

    return {
      model: this.config.defaultModel,
      messages,
      stream,
      tools,
      options: Object.keys(options).length > 0 ? options : undefined,
    };
  }

  /**
   * Convert Ollama response format to Gemini format
   */
  private convertFromOllamaResponse(response: OllamaChatResponse): GenerateContentResponse {
    const out = new GenerateContentResponse();
    
    // Build parts array from content and tool calls  
    const parts: any[] = [];
    
    // Add text content if present
    if (response.message.content) {
      parts.push({ text: response.message.content });
    }
    
    // Convert tool calls to Gemini function calls
    if (response.message.tool_calls && response.message.tool_calls.length > 0) {
      for (const toolCall of response.message.tool_calls) {
        parts.push({
          functionCall: {
            name: toolCall.function.name,
            args: toolCall.function.arguments
          }
        });
      }
    }
    
    out.candidates = [
      {
        content: {
          parts: parts.length > 0 ? parts : [{ text: '' }],
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
   * Make HTTP request to Ollama server
   */
  private async makeRequest<T>(
    endpoint: string,
    body: unknown,
    method: 'GET' | 'POST' = 'POST'
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'GeminiCLI-Ollama/1.0',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeout),
        });

        if (!response.ok) {
          throw new Error(
            `Ollama API request failed: ${response.status} ${response.statusText}`
          );
        }

        return await response.json() as T;
      } catch (error) {
        if (attempt === this.maxRetries) {
          throw new Error(`Ollama request failed after ${this.maxRetries + 1} attempts: ${error}`);
        }
        
        // Wait before retry with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw new Error('Unexpected error in makeRequest');
  }

  /**
   * Make streaming HTTP request to Ollama server
   */
  private async makeStreamingRequest(
    endpoint: string,
    body: unknown
  ): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'GeminiCLI-Ollama/1.0',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeout),
        });

        if (!response.ok) {
          throw new Error(
            `Ollama streaming request failed: ${response.status} ${response.statusText}`
          );
        }

        return response;
      } catch (error) {
        if (attempt === this.maxRetries) {
          throw new Error(`Ollama streaming request failed after ${this.maxRetries + 1} attempts: ${error}`);
        }
        
        // Wait before retry with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw new Error('Unexpected error in makeStreamingRequest');
  }
}