/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType, Config } from '@google/gemini-cli-core';
import { USER_SETTINGS_PATH } from './config/settings.js';
import { validateAuthMethod } from './config/auth.js';

export async function validateNonInteractiveAuth(
  configuredAuthType: AuthType | undefined,
  nonInteractiveConfig: Config,
) {
  // COMMENTED OUT: Only allow Ollama in non-interactive mode
  // const effectiveAuthType =
  //   configuredAuthType ||
  //   (process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true'
  //     ? AuthType.USE_VERTEX_AI
  //     : process.env.GEMINI_API_KEY
  //       ? AuthType.USE_GEMINI
  //       : undefined);

  const effectiveAuthType = configuredAuthType;

  if (!effectiveAuthType || effectiveAuthType !== AuthType.USE_OLLAMA) {
    console.error(
      `Only Ollama authentication is supported. Please configure Ollama in your ${USER_SETTINGS_PATH}`,
    );
    process.exit(1);
  }

  const err = validateAuthMethod(effectiveAuthType);
  if (err != null) {
    console.error(err);
    process.exit(1);
  }

  // Initialize auth for Ollama
  await nonInteractiveConfig.refreshAuth(effectiveAuthType);
  return nonInteractiveConfig;
}
