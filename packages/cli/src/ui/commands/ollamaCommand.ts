/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  OllamaConfig, 
  AuthType, 
  validateOllamaConfigEnhanced, 
  testOllamaConnection 
} from '@google/gemini-cli-core';
import { SettingScope } from '../../config/settings.js';
import { CommandKind, SlashCommand, CommandContext, MessageActionReturn } from './types.js';

async function showOllamaStatus(context: CommandContext): Promise<MessageActionReturn> {
  const { services } = context;
  const currentConfig = services.settings.merged.ollama;
  const isCurrentlyUsingOllama = services.settings.merged.selectedAuthType === AuthType.USE_OLLAMA;

  if (!currentConfig) {
    return {
      type: 'message',
      messageType: 'info',
      content: [
        'No Ollama configuration found.',
        '',
        'To configure Ollama, use `/auth` and select "Use Ollama (Local AI)".',
        'Or set up Ollama configuration in your settings.json file.',
      ].join('\n'),
    };
  }

  // Display current configuration
  const lines = [
    '🦙 Current Ollama Configuration:',
    '',
    `Base URL: ${currentConfig.baseUrl}`,
    `Default Model: ${currentConfig.defaultModel}`,
    `Timeout: ${currentConfig.timeout}ms`,
    `Max Retries: ${currentConfig.maxRetries}`,
    `Connection Test: ${currentConfig.connectionTestEnabled ? 'Enabled' : 'Disabled'}`,
    `Status: ${isCurrentlyUsingOllama ? '✅ Active' : '⚪ Not selected as auth method'}`,
    '',
  ];

  // Show advanced options if configured
  if (currentConfig.advancedOptions) {
    const adv = currentConfig.advancedOptions;
    lines.push('Advanced Options:');
    if (adv.temperature !== undefined) lines.push(`  Temperature: ${adv.temperature}`);
    if (adv.topP !== undefined) lines.push(`  Top P: ${adv.topP}`);
    if (adv.maxTokens !== undefined) lines.push(`  Max Tokens: ${adv.maxTokens}`);
    if (adv.systemPrompt) lines.push(`  System Prompt: ${adv.systemPrompt.substring(0, 50)}...`);
    if (adv.customOptions) lines.push(`  Custom Options: ${Object.keys(adv.customOptions).length} options`);
    lines.push('');
  }

  // Validate current configuration
  const validation = validateOllamaConfigEnhanced(currentConfig);
  if (!validation.isValid) {
    lines.push('⚠️  Configuration Issues:');
    validation.errors.forEach(error => lines.push(`  ❌ ${error}`));
    lines.push('');
  }

  if (validation.warnings.length > 0) {
    lines.push('⚠️  Configuration Warnings:');
    validation.warnings.forEach(warning => lines.push(`  ⚠️  ${warning}`));
    lines.push('');
  }

  // Test connection if enabled and valid
  if (validation.isValid && currentConfig.connectionTestEnabled) {
    lines.push('Testing connection...');
    try {
      const connectionTest = await testOllamaConnection(currentConfig);
      if (connectionTest.success) {
        lines.push(`✅ Connection successful: ${connectionTest.message}`);
        if (connectionTest.serverInfo?.models?.length) {
          lines.push('Available models:');
          connectionTest.serverInfo.models.slice(0, 5).forEach(model => 
            lines.push(`  • ${model}`)
          );
          if (connectionTest.serverInfo.models.length > 5) {
            lines.push(`  ... and ${connectionTest.serverInfo.models.length - 5} more`);
          }
        }
      } else {
        lines.push(`❌ Connection failed: ${connectionTest.message}`);
      }
    } catch (error) {
      lines.push(`❌ Connection test error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    lines.push('');
  }

  lines.push('Commands:');
  lines.push('  /auth - Change authentication method or reconfigure Ollama');
  lines.push('  /ollama test - Test connection to Ollama server');
  lines.push('  /ollama reset - Reset Ollama configuration to defaults');
  lines.push('');
  lines.push('Configuration file location:');
  lines.push(`  User: ${services.settings.user.path}`);
  if (services.settings.workspace.path !== services.settings.user.path) {
    lines.push(`  Workspace: ${services.settings.workspace.path}`);
  }

  return {
    type: 'message',
    messageType: 'info',
    content: lines.join('\n'),
  };
}

export const ollamaCommand: SlashCommand = {
  name: 'ollama',
  description: 'Configure and manage Ollama settings',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string) => {
    const trimmedArgs = args.trim();
    
    if (!trimmedArgs) {
      return await showOllamaStatus(context);
    }

    const [subcommand, ..._restArgs] = trimmedArgs.split(/\s+/);
    const { services } = context;

    switch (subcommand.toLowerCase()) {
      case 'test': {
        const currentConfig = services.settings.merged.ollama;
        if (!currentConfig) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'No Ollama configuration found. Use `/auth` to configure Ollama.',
          };
        }

        try {
          const result = await testOllamaConnection(currentConfig);
          const lines = [
            result.success ? '✅ Connection Test Passed' : '❌ Connection Test Failed',
            `Message: ${result.message}`,
          ];

          if (result.serverInfo?.models) {
            lines.push('');
            lines.push('Available models:');
            result.serverInfo.models.forEach(model => lines.push(`  • ${model}`));
          }

          return {
            type: 'message',
            messageType: result.success ? 'info' : 'error',
            content: lines.join('\n'),
          };
        } catch (error) {
          return {
            type: 'message',
            messageType: 'error',
            content: [
              '❌ Connection Test Error',
              `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            ].join('\n'),
          };
        }
      }

      case 'reset': {
        if (!services.config) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Configuration service not available.',
          };
        }

        // Reset to default configuration
        const defaultConfig: OllamaConfig = {
          baseUrl: 'http://localhost:11434',
          defaultModel: 'llama2',
          timeout: 30000,
          maxRetries: 3,
          connectionTestEnabled: true,
        };

        services.settings.setValue(SettingScope.User, 'ollama', defaultConfig);
        services.config.setOllamaConfig(defaultConfig);

        return {
          type: 'message',
          messageType: 'info',
          content: [
            '✅ Ollama configuration reset to defaults',
            '',
            'Default configuration:',
            `  Base URL: ${defaultConfig.baseUrl}`,
            `  Default Model: ${defaultConfig.defaultModel}`,
            `  Timeout: ${defaultConfig.timeout}ms`,
            `  Max Retries: ${defaultConfig.maxRetries}`,
            '',
            'Use `/ollama` to view current configuration.',
          ].join('\n'),
        };
      }

      default: {
        return {
          type: 'message',
          messageType: 'info',
          content: [
            'Available subcommands:',
            '  /ollama test - Test connection to Ollama server',
            '  /ollama reset - Reset configuration to defaults',
            '',
            'Use `/ollama` without arguments to view current configuration.',
          ].join('\n'),
        };
      }
    }
  },
};