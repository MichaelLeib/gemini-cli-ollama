/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { AuthType } from '@google/gemini-cli-core';
import { validateAuthMethod } from '../../config/auth.js';

interface AuthDialogProps {
  onSelect: (authMethod: AuthType | undefined, scope: SettingScope) => void;
  settings: LoadedSettings;
  initialErrorMessage?: string | null;
}

function parseDefaultAuthType(
  defaultAuthType: string | undefined,
): AuthType | null {
  if (
    defaultAuthType &&
    Object.values(AuthType).includes(defaultAuthType as AuthType)
  ) {
    return defaultAuthType as AuthType;
  }
  return null;
}

export function AuthDialog({
  onSelect,
  settings,
  initialErrorMessage,
}: AuthDialogProps): React.JSX.Element {
  const [errorMessage, setErrorMessage] = useState<string | null>(() => {
    if (initialErrorMessage) {
      return initialErrorMessage;
    }

    const defaultAuthType = parseDefaultAuthType(
      process.env.GEMINI_DEFAULT_AUTH_TYPE,
    );

    if (process.env.GEMINI_DEFAULT_AUTH_TYPE && defaultAuthType === null) {
      return (
        `Invalid value for GEMINI_DEFAULT_AUTH_TYPE: "${process.env.GEMINI_DEFAULT_AUTH_TYPE}". ` +
        `Valid values are: ${Object.values(AuthType).join(', ')}.`
      );
    }

    // COMMENTED OUT: Only Ollama supported
    // if (
    //   process.env.GEMINI_API_KEY &&
    //   (!defaultAuthType || defaultAuthType === AuthType.USE_GEMINI)
    // ) {
    //   return 'Existing API key detected (GEMINI_API_KEY). Select "Gemini API Key" option to use it.';
    // }
    return null;
  });
  // COMMENTED OUT: Only show Ollama option
  const items = [
    {
      label: 'Configure Ollama (Local AI)',
      value: AuthType.USE_OLLAMA,
    },
    // COMMENTED OUT: Other auth methods disabled
    // {
    //   label: 'Login with Google',
    //   value: AuthType.LOGIN_WITH_GOOGLE,
    // },
    // ...(process.env.CLOUD_SHELL === 'true'
    //   ? [
    //       {
    //         label: 'Use Cloud Shell user credentials',
    //         value: AuthType.CLOUD_SHELL,
    //       },
    //     ]
    //   : []),
    // {
    //   label: 'Use Gemini API Key',
    //   value: AuthType.USE_GEMINI,
    // },
    // { label: 'Vertex AI', value: AuthType.USE_VERTEX_AI },
  ];

  // COMMENTED OUT: Only allow Ollama selection
  const initialAuthIndex = items.findIndex((item) => {
    if (settings.merged.selectedAuthType && settings.merged.selectedAuthType === AuthType.USE_OLLAMA) {
      return item.value === settings.merged.selectedAuthType;
    }

    // COMMENTED OUT: Other auth type detection disabled
    // const defaultAuthType = parseDefaultAuthType(
    //   process.env.GEMINI_DEFAULT_AUTH_TYPE,
    // );
    // if (defaultAuthType) {
    //   return item.value === defaultAuthType;
    // }

    // if (process.env.GEMINI_API_KEY) {
    //   return item.value === AuthType.USE_GEMINI;
    // }

    // Always default to Ollama (only supported option)
    return item.value === AuthType.USE_OLLAMA;
  });

  const handleAuthSelect = (authMethod: AuthType) => {
    const error = validateAuthMethod(authMethod);
    if (error) {
      setErrorMessage(error);
    } else {
      setErrorMessage(null);
      onSelect(authMethod, SettingScope.User);
    }
  };

  useInput((_input, key) => {
    if (key.escape) {
      // Prevent exit if there is an error message.
      // This means they user is not authenticated yet.
      if (errorMessage) {
        return;
      }
      if (settings.merged.selectedAuthType === undefined) {
        // Prevent exiting if no auth method is set
        setErrorMessage(
          'You must select an auth method to proceed. Press Ctrl+C twice to exit.',
        );
        return;
      }
      onSelect(undefined, SettingScope.User);
    }
  });

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>Configure Ollama</Text>
      <Box marginTop={1}>
        <Text>This CLI now only supports Ollama (local AI). Select the option below to configure your Ollama connection.</Text>
      </Box>
      <Box marginTop={1}>
        <RadioButtonSelect
          items={items}
          initialIndex={initialAuthIndex}
          onSelect={handleAuthSelect}
          isFocused={true}
        />
      </Box>
      {errorMessage && (
        <Box marginTop={1}>
          <Text color={Colors.AccentRed}>{errorMessage}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={Colors.Gray}>(Use Enter to select)</Text>
      </Box>
      <Box marginTop={1}>
        <Text>Terms of Services and Privacy Notice for Gemini CLI</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.AccentBlue}>
          {
            'https://github.com/google-gemini/gemini-cli/blob/main/docs/tos-privacy.md'
          }
        </Text>
      </Box>
    </Box>
  );
}
