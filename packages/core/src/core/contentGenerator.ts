/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  // GoogleGenAI, // COMMENTED OUT: Google GenAI disabled
} from '@google/genai';
// import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js'; // COMMENTED OUT: CodeAssist disabled
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { Config } from '../config/config.js';
// import { getEffectiveModel } from './modelCheck.js'; // COMMENTED OUT: Model checking disabled
import { UserTierId } from '../code_assist/types.js';
import { createOllamaContentGenerator } from '../ollama/ollamaContentGenerator.js';

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;

  userTier?: UserTierId;
}

export enum AuthType {
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  CLOUD_SHELL = 'cloud-shell',
  USE_OLLAMA = 'ollama',
}

export type ContentGeneratorConfig = {
  model: string;
  apiKey?: string;
  vertexai?: boolean;
  authType?: AuthType | undefined;
  proxy?: string | undefined;
  ollamaBaseUrl?: string;
};

export function createContentGeneratorConfig(
  config: Config,
  authType: AuthType | undefined,
): ContentGeneratorConfig {
  // COMMENTED OUT: Environment variables for other auth methods
  // const geminiApiKey = process.env.GEMINI_API_KEY || undefined;
  // const googleApiKey = process.env.GOOGLE_API_KEY || undefined;
  // const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT || undefined;
  // const googleCloudLocation = process.env.GOOGLE_CLOUD_LOCATION || undefined;

  // Use runtime model from config if available; otherwise, fall back to parameter or default
  const effectiveModel = config.getModel() || DEFAULT_GEMINI_MODEL;

  const contentGeneratorConfig: ContentGeneratorConfig = {
    model: effectiveModel,
    authType,
    proxy: config?.getProxy(),
  };

  // COMMENTED OUT: Only support Ollama authentication
  // if (
  //   authType === AuthType.LOGIN_WITH_GOOGLE ||
  //   authType === AuthType.CLOUD_SHELL
  // ) {
  //   return contentGeneratorConfig;
  // }

  if (authType === AuthType.USE_OLLAMA) {
    const ollamaConfig = config.getOllamaConfig();
    contentGeneratorConfig.ollamaBaseUrl = ollamaConfig.baseUrl;
    contentGeneratorConfig.model = ollamaConfig.defaultModel;
    return contentGeneratorConfig;
  }

  // COMMENTED OUT: Other auth methods disabled
  // if (authType === AuthType.USE_GEMINI && geminiApiKey) {
  //   contentGeneratorConfig.apiKey = geminiApiKey;
  //   contentGeneratorConfig.vertexai = false;
  //   getEffectiveModel(
  //     contentGeneratorConfig.apiKey,
  //     contentGeneratorConfig.model,
  //     contentGeneratorConfig.proxy,
  //   );

  //   return contentGeneratorConfig;
  // }

  // if (
  //   authType === AuthType.USE_VERTEX_AI &&
  //   (googleApiKey || (googleCloudProject && googleCloudLocation))
  // ) {
  //   contentGeneratorConfig.apiKey = googleApiKey;
  //   contentGeneratorConfig.vertexai = true;

  //   return contentGeneratorConfig;
  // }

  return contentGeneratorConfig;
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
  gcConfig: Config,
  _sessionId?: string, // COMMENTED OUT: Only used for disabled auth methods
): Promise<ContentGenerator> {
  // COMMENTED OUT: HTTP options only used for disabled auth methods
  // const version = process.env.CLI_VERSION || process.version;
  // const httpOptions = {
  //   headers: {
  //     'User-Agent': `GeminiCLI/${version} (${process.platform}; ${process.arch})`,
  //   },
  // };
  // COMMENTED OUT: Only support Ollama content generation
  // if (
  //   config.authType === AuthType.LOGIN_WITH_GOOGLE ||
  //   config.authType === AuthType.CLOUD_SHELL
  // ) {
  //   return createCodeAssistContentGenerator(
  //     httpOptions,
  //     config.authType,
  //     gcConfig,
  //     sessionId,
  //   );
  // }

  if (config.authType === AuthType.USE_OLLAMA) {
    const ollamaConfig = gcConfig.getOllamaConfig();
    return await createOllamaContentGenerator(ollamaConfig, gcConfig);
  }

  // COMMENTED OUT: Other content generators disabled
  // if (
  //   config.authType === AuthType.USE_GEMINI ||
  //   config.authType === AuthType.USE_VERTEX_AI
  // ) {
  //   const googleGenAI = new GoogleGenAI({
  //     apiKey: config.apiKey === '' ? undefined : config.apiKey,
  //     vertexai: config.vertexai,
  //     httpOptions,
  //   });

  //   return googleGenAI.models;
  // }

  throw new Error(
    `Error creating contentGenerator: Unsupported authType: ${config.authType}`,
  );
}
