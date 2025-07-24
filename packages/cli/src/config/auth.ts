/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType } from '@google/gemini-cli-core';
import { loadEnvironment } from './settings.js';

export const validateAuthMethod = (authMethod: string): string | null => {
  loadEnvironment();
  
  // COMMENTED OUT: Only allow Ollama authentication
  // if (
  //   authMethod === AuthType.LOGIN_WITH_GOOGLE ||
  //   authMethod === AuthType.CLOUD_SHELL
  // ) {
  //   return 'Google authentication temporarily disabled - only Ollama is supported';
  // }

  // if (authMethod === AuthType.USE_GEMINI) {
  //   return 'Gemini API authentication temporarily disabled - only Ollama is supported';
  // }

  // if (authMethod === AuthType.USE_VERTEX_AI) {
  //   return 'Vertex AI authentication temporarily disabled - only Ollama is supported';
  // }

  if (authMethod === AuthType.USE_OLLAMA) {
    // Ollama doesn't require environment variables, configuration is handled through the UI
    return null;
  }

  return 'Only Ollama authentication is currently supported.';
};
