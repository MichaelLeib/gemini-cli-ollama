/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import {
  AuthType,
  Config,
  OllamaConfig,
  clearCachedCredentialFile,
  getErrorMessage,
} from '@google/gemini-cli-core';
// import { runExitCleanup } from '../../utils/cleanup.js'; // COMMENTED OUT: Google auth cleanup disabled

export const useAuthCommand = (
  settings: LoadedSettings,
  setAuthError: (error: string | null) => void,
  config: Config,
) => {
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(
    settings.merged.selectedAuthType === undefined || settings.merged.selectedAuthType !== AuthType.USE_OLLAMA,
  );
  const [isOllamaConfigDialogOpen, setIsOllamaConfigDialogOpen] = useState(false);

  const openAuthDialog = useCallback(() => {
    setIsAuthDialogOpen(true);
  }, []);

  const _openOllamaConfigDialog = useCallback(() => {
    setIsOllamaConfigDialogOpen(true);
  }, []);

  const _closeOllamaConfigDialog = useCallback(() => {
    setIsOllamaConfigDialogOpen(false);
  }, []);

  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    const authFlow = async () => {
      const authType = settings.merged.selectedAuthType;
      if (isAuthDialogOpen || !authType) {
        return;
      }

      // For Ollama, check if it's configured before attempting auth
      if (authType === AuthType.USE_OLLAMA) {
        const ollamaConfig = config.getOllamaConfig();
        if (!ollamaConfig || !ollamaConfig.baseUrl || !ollamaConfig.defaultModel) {
          console.log('Ollama not configured, opening configuration dialog');
          setIsAuthDialogOpen(false);
          setIsOllamaConfigDialogOpen(true);
          return;
        }
      }

      try {
        setIsAuthenticating(true);
        console.log(`Attempting authentication with: ${authType}`);
        await config.refreshAuth(authType);
        console.log(`Authenticated via "${authType}".`);
      } catch (e) {
        console.error(`Authentication failed for ${authType}:`, e);
        setAuthError(`Failed to login. Message: ${getErrorMessage(e)}`);
        if (authType === AuthType.USE_OLLAMA) {
          setIsOllamaConfigDialogOpen(true);
        } else {
          openAuthDialog();
        }
      } finally {
        setIsAuthenticating(false);
      }
    };

    void authFlow();
  }, [isAuthDialogOpen, settings, config, setAuthError, openAuthDialog]);

  const handleAuthSelect = useCallback(
    async (authType: AuthType | undefined, scope: SettingScope) => {
      if (authType) {
        await clearCachedCredentialFile();

        // Special handling for Ollama - show configuration dialog
        if (authType === AuthType.USE_OLLAMA) {
          setIsAuthDialogOpen(false);
          setIsOllamaConfigDialogOpen(true);
          return;
        }

        // COMMENTED OUT: Only Ollama auth supported
        if ((authType as AuthType) !== AuthType.USE_OLLAMA) {
          console.error('Only Ollama authentication is supported.');
          return;
        }
        settings.setValue(scope, 'selectedAuthType', authType);
        
        // COMMENTED OUT: Google auth handling disabled
        // if (
        //   authType === AuthType.LOGIN_WITH_GOOGLE &&
        //   config.isBrowserLaunchSuppressed()
        // ) {
        //   runExitCleanup();
        //   console.log(
        //     `
// ----------------------------------------------------------------
// Logging in with Google... Please restart Gemini CLI to continue.
// ----------------------------------------------------------------
        //     `,
        //   );
        //   process.exit(0);
        // }
      }
      setIsAuthDialogOpen(false);
      setAuthError(null);
    },
    [settings, setAuthError], // config removed as it's not used in the commented out auth flows
  );

  const handleOllamaConfigComplete = useCallback(
    (ollamaConfig: OllamaConfig) => {
      // Save Ollama configuration and set auth type
      console.log('Saving Ollama config with timeout:', ollamaConfig.timeout + 'ms');
      config.setOllamaConfig(ollamaConfig);
      settings.setValue(SettingScope.User, 'selectedAuthType', AuthType.USE_OLLAMA);
      settings.setValue(SettingScope.User, 'ollama', ollamaConfig);
      setIsOllamaConfigDialogOpen(false);
      setAuthError(null);
    },
    [config, settings, setAuthError],
  );

  const handleOllamaConfigCancel = useCallback(() => {
    setIsOllamaConfigDialogOpen(false);
    setIsAuthDialogOpen(true); // Go back to auth selection
  }, []);

  const cancelAuthentication = useCallback(() => {
    setIsAuthenticating(false);
  }, []);

  return {
    isAuthDialogOpen,
    openAuthDialog,
    handleAuthSelect,
    isAuthenticating,
    cancelAuthentication,
    isOllamaConfigDialogOpen,
    handleOllamaConfigComplete,
    handleOllamaConfigCancel,
  };
};
