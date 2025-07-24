/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GenerateContentParameters,
  GenerateContentResponse,
  Content,
  Part,
  FinishReason,
  Tool,
  FunctionDeclaration,
} from '@google/genai';
import { 
  OllamaChatRequest, 
  OllamaChatResponse, 
  OllamaStreamResponse,
  OllamaTool
} from './ollamaClient.js';
import { OllamaConfig } from '../config/ollamaConfig.js';

/**
 * Utility class for converting between Gemini API format and Ollama API format
 */
export class OllamaConverter {
  constructor(private readonly config: OllamaConfig) {}

  /**
   * Convert Gemini GenerateContentParameters to Ollama chat request format
   */
  static geminiToOllama(
    request: GenerateContentParameters, 
    config: OllamaConfig,
    stream: boolean = false
  ): OllamaChatRequest {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    
    // Add system instruction if present in config
    if (request.config?.systemInstruction) {
      let systemContent = '';
      const systemInstruction = request.config.systemInstruction;
      
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
    
    // Add system prompt from config if no system instruction in request
    if (!request.config?.systemInstruction && config.advancedOptions?.systemPrompt) {
      messages.push({
        role: 'system',
        content: config.advancedOptions.systemPrompt
      });
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
        const messageContent = this.extractTextFromContent(content);
        if (messageContent) {
          messages.push({
            role: this.convertRole(content.role),
            content: messageContent
          });
        }
      }
    }
    
    // Build options from generation config and advanced options
    const options = this.buildOllamaOptions(request, config);

    return {
      model: config.defaultModel,
      messages,
      stream,
      options: Object.keys(options).length > 0 ? options : undefined,
    };
  }

  /**
   * Convert Ollama chat response to Gemini GenerateContentResponse format
   */
  static ollamaToGemini(response: OllamaChatResponse): GenerateContentResponse {
    const finishReason = this.convertFinishReason(response);
    
    const out = new GenerateContentResponse();
    out.candidates = [
      {
        content: {
          parts: [{ text: response.message.content }],
          role: 'model',
        },
        finishReason,
        index: 0,
        safetyRatings: [], // Ollama doesn't provide safety ratings
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
   * Convert streaming Ollama response to Gemini format
   */
  static convertStreamingResponse(response: OllamaStreamResponse): GenerateContentResponse {
    const finishReason = this.convertFinishReason(response);
    
    const out = new GenerateContentResponse();
    out.candidates = [
      {
        content: {
          parts: [{ text: response.message.content }],
          role: 'model',
        },
        finishReason,
        index: 0,
        safetyRatings: [],
      },
    ];
    out.usageMetadata = response.done ? {
      promptTokenCount: response.prompt_eval_count || 0,
      candidatesTokenCount: response.eval_count || 0,
      totalTokenCount: (response.prompt_eval_count || 0) + (response.eval_count || 0),
    } : undefined;
    out.modelVersion = response.model;
    return out;
  }

  /**
   * Extract text content from system instruction
   */
  private static extractTextFromSystemInstruction(
    systemInstruction: string | { text?: string; parts?: Part[] }
  ): string {
    if (typeof systemInstruction === 'string') {
      return systemInstruction;
    }
    
    if (systemInstruction.text) {
      return systemInstruction.text;
    }
    
    if (systemInstruction.parts) {
      return systemInstruction.parts
        .filter(part => 'text' in part)
        .map(part => ('text' in part ? part.text : ''))
        .join('\n');
    }
    
    return '';
  }

  /**
   * Extract text content from Gemini Content object
   */
  private static extractTextFromContent(content: Content): string {
    if (!content.parts) {
      return '';
    }
    
    return content.parts
      .filter(part => 'text' in part)
      .map(part => {
        if ('text' in part) {
          return part.text;
        }
        // Handle other part types if needed (images, etc.)
        if ('inlineData' in part) {
          return '[Image data not supported by Ollama]';
        }
        if ('fileData' in part) {
          return '[File data not supported by Ollama]';
        }
        return '';
      })
      .join('\n');
  }

  /**
   * Convert Gemini role to Ollama role
   */
  private static convertRole(role?: string): 'system' | 'user' | 'assistant' {
    switch (role) {
      case 'model':
        return 'assistant';
      case 'user':
        return 'user';
      case 'system':
        return 'system';
      default:
        return 'user';
    }
  }

  /**
   * Convert Ollama response status to Gemini finish reason
   */
  private static convertFinishReason(response: OllamaChatResponse | OllamaStreamResponse): FinishReason | undefined {
    if (!response.done) {
      return undefined;
    }
    
    // Check if it's a streaming response with done_reason
    if ('done_reason' in response && response.done_reason) {
      switch (response.done_reason) {
        case 'stop':
          return FinishReason.STOP;
        case 'length':
          return FinishReason.MAX_TOKENS;
        default:
          return FinishReason.OTHER;
      }
    }
    
    // For regular responses, assume normal completion
    return FinishReason.STOP;
  }

  /**
   * Build Ollama options from Gemini generation config and Ollama advanced options
   */
  private static buildOllamaOptions(
    request: GenerateContentParameters, 
    config: OllamaConfig
  ): Record<string, unknown> {
    const options: Record<string, unknown> = {};
    
    // Apply generation config from request
    if (request.config) {
      const genConfig = request.config;
      
      if (genConfig.temperature !== undefined) {
        options.temperature = genConfig.temperature;
      }
      if (genConfig.topP !== undefined) {
        options.top_p = genConfig.topP;
      }
      if (genConfig.maxOutputTokens !== undefined) {
        options.max_tokens = genConfig.maxOutputTokens;
      }
      if (genConfig.topK !== undefined) {
        options.top_k = genConfig.topK;
      }
    }
    
    // Apply advanced options from config (lower priority than request config)
    if (config.advancedOptions) {
      const advancedOptions = config.advancedOptions;
      
      if (advancedOptions.temperature !== undefined && options.temperature === undefined) {
        options.temperature = advancedOptions.temperature;
      }
      if (advancedOptions.topP !== undefined && options.top_p === undefined) {
        options.top_p = advancedOptions.topP;
      }
      if (advancedOptions.maxTokens !== undefined && options.max_tokens === undefined) {
        options.max_tokens = advancedOptions.maxTokens;
      }
      
      // Apply custom options
      if (advancedOptions.customOptions) {
        // Custom options have lowest priority
        for (const [key, value] of Object.entries(advancedOptions.customOptions)) {
          if (options[key] === undefined) {
            options[key] = value;
          }
        }
      }
    }
    
    return options;
  }

  /**
   * Convert Gemini tools to Ollama format
   */
  static convertToolsToOllama(geminiTools: Tool[]): OllamaTool[] {
    const ollamaTools: OllamaTool[] = [];
    
    for (const tool of geminiTools) {
      if ('functionDeclarations' in tool && tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          ollamaTools.push({
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
    
    return ollamaTools;
  }

  /**
   * Validate that the request is compatible with Ollama
   */
  static validateRequest(request: GenerateContentParameters): string[] {
    const errors: string[] = [];
    
    // Tool calling is now supported by Ollama
    // We'll convert Gemini tools to Ollama format
    
    if (request.contents) {
      // Handle ContentListUnion properly
      if (typeof request.contents === 'string') {
        // String content is fine
      } else if (Array.isArray(request.contents)) {
        // Check if it's Content[] or PartUnion[]
        if (request.contents.length > 0 && typeof request.contents[0] === 'object' && 'role' in request.contents[0]) {
          // It's Content[]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const content of request.contents as any[]) {
            if (content.parts) {
              for (const part of content.parts) {
                if ('inlineData' in part || 'fileData' in part) {
                  errors.push('Multimodal inputs (images, files) are not supported by Ollama');
                  break;
                }
              }
            }
          }
        } else {
          // It's PartUnion[]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const part of request.contents as any[]) {
            if ('inlineData' in part || 'fileData' in part) {
              errors.push('Multimodal inputs (images, files) are not supported by Ollama');
              break;
            }
          }
        }
      }
    }
    
    // Check generation config for unsupported options
    if (request.config) {
      const genConfig = request.config;
      
      if (genConfig.candidateCount && genConfig.candidateCount > 1) {
        errors.push('Multiple candidates are not supported by Ollama');
      }
      
      if (genConfig.stopSequences && genConfig.stopSequences.length > 0) {
        errors.push('Custom stop sequences are not supported by Ollama');
      }
      
      // responseMimeType is removed during sanitization, so no warning needed
      // Ollama supports structured outputs through its format parameter
    }
    
    return errors;
  }

  /**
   * Sanitize request for Ollama compatibility
   * Removes unsupported features and warns about them
   */
  static sanitizeRequest(request: GenerateContentParameters): GenerateContentParameters {
    const sanitized = { ...request };
    
    // Keep tools for Ollama (they're now supported)
    // Only remove toolConfig which is not used by Ollama
    if (sanitized.config) {
      delete sanitized.config.toolConfig;
    }
    
    // Sanitize generation config
    if (sanitized.config) {
      const genConfig = { ...sanitized.config };
      
      // Force single candidate
      if (genConfig.candidateCount && genConfig.candidateCount > 1) {
        genConfig.candidateCount = 1;
      }
      
      // Remove unsupported options
      delete genConfig.stopSequences;
      delete genConfig.responseMimeType;
      delete genConfig.responseSchema;
      
      sanitized.config = genConfig;
    }
    
    // Sanitize contents to remove multimodal parts
    if (sanitized.contents) {
      const contents = Array.isArray(sanitized.contents) ? sanitized.contents : [sanitized.contents];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sanitized.contents = contents.map((content: any) => ({
        ...content,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parts: content.parts?.filter((part: any) => typeof part === 'string' || 'text' in part) || []
      }));
    }
    
    return sanitized;
  }
}