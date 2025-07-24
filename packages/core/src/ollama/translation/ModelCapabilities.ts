/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Defines tool calling capabilities for different Ollama models
 */
export interface ModelToolCapabilities {
  /** Whether the model supports tool calling */
  supportsTools: boolean;
  
  /** Tool format the model expects */
  toolFormat: 'openai' | 'hermes' | 'custom';
  
  /** Maximum number of tools the model can handle */
  maxTools: number;
  
  /** Whether the model supports parallel tool calls */
  supportsParallel: boolean;
  
  /** Whether the model supports streaming tool calls */
  supportsStreaming: boolean;
  
  /** Custom parser name for special model formats */
  customParser?: string;
  
  /** Prompting style that works best with the model */
  promptStyle: 'standard' | 'agentic' | 'hermes';
  
  /** How well the model handles multi-turn tool calling */
  multiTurnSupport: 'excellent' | 'good' | 'poor';
  
  /** Specific model version or variant */
  version?: string;
  
  /** Additional model-specific configuration */
  config?: {
    /** Context window size that improves tool calling */
    recommendedContextSize?: number;
    
    /** Whether the model needs explicit tool choice instructions */
    requiresExplicitToolChoice?: boolean;
    
    /** Special tokens or formatting requirements */
    specialTokens?: string[];
  };
}

/**
 * Model capability mappings for known Ollama models
 */
export const MODEL_CAPABILITIES: Record<string, ModelToolCapabilities> = {
  // Qwen 2.5 Coder models
  'qwen2.5-coder:32b': {
    supportsTools: true,
    toolFormat: 'hermes',
    maxTools: 64,
    supportsParallel: true,
    supportsStreaming: true,
    customParser: 'qwen3coder',
    promptStyle: 'hermes',
    multiTurnSupport: 'good',
    config: {
      recommendedContextSize: 32768,
      requiresExplicitToolChoice: false,
      specialTokens: ['<tool_call>', '</tool_call>']
    }
  },
  
  'qwen2.5-coder:14b': {
    supportsTools: true,
    toolFormat: 'hermes',
    maxTools: 32,
    supportsParallel: true,
    supportsStreaming: true,
    customParser: 'qwen3coder',
    promptStyle: 'hermes',
    multiTurnSupport: 'good',
    config: {
      recommendedContextSize: 32768,
      requiresExplicitToolChoice: false
    }
  },
  
  'qwen2.5-coder:7b': {
    supportsTools: true,
    toolFormat: 'hermes',
    maxTools: 16,
    supportsParallel: false,
    supportsStreaming: true,
    customParser: 'qwen3coder',
    promptStyle: 'hermes',
    multiTurnSupport: 'good'
  },
  
  // Mistral models
  'mistral:latest': {
    supportsTools: true,
    toolFormat: 'openai',
    maxTools: 128,
    supportsParallel: true,
    supportsStreaming: false,
    promptStyle: 'standard',
    multiTurnSupport: 'excellent',
    config: {
      requiresExplicitToolChoice: true
    }
  },
  
  'mistral-nemo': {
    supportsTools: true,
    toolFormat: 'openai',
    maxTools: 64,
    supportsParallel: true,
    supportsStreaming: false,
    promptStyle: 'standard',
    multiTurnSupport: 'excellent'
  },
  
  'codestral': {
    supportsTools: true,
    toolFormat: 'openai',
    maxTools: 32,
    supportsParallel: true,
    supportsStreaming: false,
    promptStyle: 'standard',
    multiTurnSupport: 'good'
  },
  
  // DeepSeek models
  'deepseek-chat': {
    supportsTools: true,
    toolFormat: 'openai',
    maxTools: 128,
    supportsParallel: true,
    supportsStreaming: false,
    promptStyle: 'standard',
    multiTurnSupport: 'poor',
    config: {
      requiresExplicitToolChoice: true
    }
  },
  
  'deepseek-reasoner': {
    supportsTools: true,
    toolFormat: 'openai',
    maxTools: 64,
    supportsParallel: true,
    supportsStreaming: false,
    promptStyle: 'standard',
    multiTurnSupport: 'poor',
    version: 'R1-0528'
  },
  
  // Kimi K2 models  
  'kimi-k2': {
    supportsTools: true,
    toolFormat: 'openai',
    maxTools: 64,
    supportsParallel: true,
    supportsStreaming: true,
    promptStyle: 'agentic',
    multiTurnSupport: 'excellent',
    config: {
      recommendedContextSize: 128000,
      requiresExplicitToolChoice: false
    }
  },
  
  // Llama models with tool support
  'llama3.1:latest': {
    supportsTools: true,
    toolFormat: 'openai',
    maxTools: 32,
    supportsParallel: true,
    supportsStreaming: true,
    promptStyle: 'standard',
    multiTurnSupport: 'good'
  },
  
  'llama3.2:latest': {
    supportsTools: true,
    toolFormat: 'openai',
    maxTools: 16,
    supportsParallel: false,
    supportsStreaming: true,
    promptStyle: 'standard',
    multiTurnSupport: 'good'
  },
  
  // Firefunction models
  'firefunction-v2': {
    supportsTools: true,
    toolFormat: 'openai',
    maxTools: 64,
    supportsParallel: true,
    supportsStreaming: false,
    promptStyle: 'standard',
    multiTurnSupport: 'good'
  },
  
  // Command-R models
  'command-r-plus': {
    supportsTools: true,
    toolFormat: 'openai',
    maxTools: 32,
    supportsParallel: true,
    supportsStreaming: false,
    promptStyle: 'standard',
    multiTurnSupport: 'good'
  }
};

/**
 * Default capabilities for unknown models
 */
export const DEFAULT_MODEL_CAPABILITIES: ModelToolCapabilities = {
  supportsTools: false,
  toolFormat: 'openai',
  maxTools: 0,
  supportsParallel: false,
  supportsStreaming: false,
  promptStyle: 'standard',
  multiTurnSupport: 'poor'
};

/**
 * Get tool capabilities for a specific model
 */
export function getModelCapabilities(modelName: string): ModelToolCapabilities {
  // Normalize model name (remove version tags, etc.)
  const normalizedName = normalizeModelName(modelName);
  
  // Try exact match first
  if (MODEL_CAPABILITIES[modelName]) {
    return MODEL_CAPABILITIES[modelName];
  }
  
  // Try normalized match
  if (MODEL_CAPABILITIES[normalizedName]) {
    return MODEL_CAPABILITIES[normalizedName];
  }
  
  // Try partial matches for known model families
  for (const [knownModel, capabilities] of Object.entries(MODEL_CAPABILITIES)) {
    if (modelName.includes(knownModel) || knownModel.includes(normalizedName)) {
      return capabilities;
    }
  }
  
  console.warn(`Unknown model: ${modelName}. Tool calling disabled.`);
  return DEFAULT_MODEL_CAPABILITIES;
}

/**
 * Normalize model name for matching
 */
function normalizeModelName(modelName: string): string {
  return modelName
    .toLowerCase()
    .replace(/[:@]/g, '-')
    .replace(/-\d+[bm]$/, '') // Remove size indicators like -7b, -32b
    .replace(/-instruct$/, '')
    .replace(/-chat$/, '')
    .replace(/-latest$/, '');
}

/**
 * Check if a model supports tool calling
 */
export function modelSupportsTools(modelName: string): boolean {
  return getModelCapabilities(modelName).supportsTools;
}

/**
 * Get recommended configuration for a model
 */
export function getModelRecommendedConfig(modelName: string): Record<string, unknown> {
  const capabilities = getModelCapabilities(modelName);
  const config: Record<string, unknown> = {};
  
  if (capabilities.config?.recommendedContextSize) {
    config.num_ctx = capabilities.config.recommendedContextSize;
  }
  
  if (capabilities.config?.requiresExplicitToolChoice) {
    config.tool_choice = 'auto';
  }
  
  return config;
}