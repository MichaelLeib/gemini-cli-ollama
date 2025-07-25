/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { 
  OllamaConfig, 
  mergeOllamaConfig,
  validateOllamaSetup,
  createOllamaContentGenerator 
} from '@google/gemini-cli-core';
import { getModelRecommendedTimeout } from '@google/gemini-cli-core';

interface OllamaConfigDialogProps {
  onComplete: (config: OllamaConfig) => void;
  onCancel: () => void;
  initialConfig?: Partial<OllamaConfig>;
}

enum ConfigStep {
  BASE_URL = 'baseUrl',
  MODEL_SELECTION = 'modelSelection',
  TIMEOUT_CONFIG = 'timeoutConfig',
  TESTING = 'testing',
  SUMMARY = 'summary',
}

interface ConfigState {
  baseUrl: string;
  selectedModel: string;
  availableModels: string[];
  temperature: number;
  topP: number;
  maxTokens: number;
  systemPrompt: string;
  timeout: number;
  maxRetries: number;
  connectionTestEnabled: boolean;
}

export function OllamaConfigDialog({ 
  onComplete, 
  onCancel, 
  initialConfig 
}: OllamaConfigDialogProps): React.JSX.Element {
  const [currentStep, setCurrentStep] = useState<ConfigStep>(ConfigStep.BASE_URL);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  
  const [configState, setConfigState] = useState<ConfigState>(() => {
    const merged = mergeOllamaConfig(initialConfig);
    return {
      baseUrl: merged.baseUrl,
      selectedModel: merged.defaultModel,
      availableModels: [],
      temperature: merged.advancedOptions?.temperature ?? 0.7,
      topP: merged.advancedOptions?.topP ?? 0.9,
      maxTokens: merged.advancedOptions?.maxTokens ?? 4096,
      systemPrompt: merged.advancedOptions?.systemPrompt ?? '',
      timeout: merged.timeout,
      maxRetries: merged.maxRetries,
      connectionTestEnabled: merged.connectionTestEnabled,
    };
  });

  // Input handlers for different configuration steps
  const [baseUrlInput, setBaseUrlInput] = useState(configState.baseUrl);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [timeoutInput, setTimeoutInput] = useState((configState.timeout / 1000).toString());

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (isLoading) {
      return; // Ignore input while loading
    }

    // Handle different steps
    switch (currentStep) {
      case ConfigStep.BASE_URL:
        handleBaseUrlInput(input, key);
        break;
      case ConfigStep.MODEL_SELECTION:
        // Handled by RadioButtonSelect
        break;
      case ConfigStep.TIMEOUT_CONFIG:
        handleTimeoutInput(input, key);
        break;
      case ConfigStep.TESTING:
        handleTestingInput(input, key);  
        break;
      case ConfigStep.SUMMARY:
        handleSummaryInput(input, key);
        break;
      default:
        // No action needed for other steps
        break;
    }
  });

  const handleBaseUrlInput = (input: string, key: {return?: boolean; backspace?: boolean}) => {
    if (key.return) {
      const finalUrl = baseUrlInput.trim() || 'http://localhost:11434';
      setConfigState(prev => ({ ...prev, baseUrl: finalUrl }));
      proceedToModelSelection();
    } else if (key.backspace) {
      setBaseUrlInput(prev => prev.slice(0, -1));
      setError(null);
    } else if (input) {
      setBaseUrlInput(prev => prev + input);
      setError(null);
    }
  };

  const handleTimeoutInput = (input: string, key: {return?: boolean; backspace?: boolean}) => {
    if (key.return) {
      let timeoutSeconds: number;
      
      if (timeoutInput.trim() === '') {
        // Use recommended timeout if input is empty
        const recommendedTimeout = getModelRecommendedTimeout(configState.selectedModel);
        timeoutSeconds = Math.floor(recommendedTimeout / 1000);
      } else {
        timeoutSeconds = parseInt(timeoutInput, 10);
      }
      
      if (!isNaN(timeoutSeconds) && timeoutSeconds > 0) {
        console.log(`Setting timeout to ${timeoutSeconds} seconds (${timeoutSeconds * 1000}ms)`);
        setConfigState(prev => ({ ...prev, timeout: timeoutSeconds * 1000 }));
        proceedToTesting();
      } else {
        setError('Please enter a valid timeout in seconds (greater than 0)');
      }
    } else if (key.backspace) {
      setTimeoutInput(prev => prev.slice(0, -1));
      setError(null);
    } else if (input && /^\d$/.test(input)) {
      setTimeoutInput(prev => prev + input);
      setError(null);
    }
  };

  const handleTestingInput = (input: string, key: {return?: boolean}) => {
    if (key.return) {
      if (input.toLowerCase() === 'y' || input.toLowerCase() === '') {
        performConnectionTest();
      } else {
        proceedToSummary();
      }
    }
  };

  const handleSummaryInput = (input: string, key: {return?: boolean}) => {
    if (key.return) {
      if (input.toLowerCase() === 'y' || input.toLowerCase() === '') {
        completeConfiguration();
      } else {
        onCancel();
      }
    }
  };

  const proceedToModelSelection = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Test connection and fetch models
      const testConfig = mergeOllamaConfig({
        baseUrl: configState.baseUrl,
        defaultModel: 'test', // Temporary
        connectionTestEnabled: true,
      });
      
      const generator = await createOllamaContentGenerator(testConfig);
      const models = await generator.getAvailableModels();
      
      let availableModels = models;
      
      // If no models found on server, provide some common fallback models
      if (models.length === 0) {
        availableModels = ['llama2', 'mistral', 'codellama', 'phi', 'neural-chat'];
        setWarnings(['No models found on server. Showing common models - you may need to pull them first.']);
      }
      
      setConfigState(prev => ({ 
        ...prev, 
        availableModels,
        selectedModel: availableModels.includes(prev.selectedModel) ? prev.selectedModel : availableModels[0]
      }));
      
      setSelectedModelIndex(availableModels.indexOf(configState.selectedModel) >= 0 
        ? availableModels.indexOf(configState.selectedModel) 
        : 0
      );
      
      setCurrentStep(ConfigStep.MODEL_SELECTION);
    } catch (err) {
      // If server connection fails, still allow configuration with fallback models
      const fallbackModels = ['llama2', 'mistral', 'codellama', 'phi', 'neural-chat'];
      setConfigState(prev => ({ 
        ...prev, 
        availableModels: fallbackModels,
        selectedModel: fallbackModels.includes(prev.selectedModel) ? prev.selectedModel : fallbackModels[0]
      }));
      
      setSelectedModelIndex(0);
      setWarnings([`Could not connect to server: ${err}. Showing common models - you may need to pull them first.`]);
      setCurrentStep(ConfigStep.MODEL_SELECTION);
    } finally {
      setIsLoading(false);
    }
  };

  const proceedToTimeoutConfig = () => {
    const selectedModel = configState.availableModels[selectedModelIndex];
    const recommendedTimeout = getModelRecommendedTimeout(selectedModel);
    
    setConfigState(prev => ({ 
      ...prev, 
      selectedModel,
      timeout: recommendedTimeout 
    }));
    setTimeoutInput((recommendedTimeout / 1000).toString());
    setCurrentStep(ConfigStep.TIMEOUT_CONFIG);
  };

  const proceedToTesting = () => {
    setCurrentStep(ConfigStep.TESTING);
  };

  const proceedToSummary = () => {
    setCurrentStep(ConfigStep.SUMMARY);
  };

  const performConnectionTest = async () => {
    setIsLoading(true);
    setError(null);
    setWarnings([]);
    
    try {
      const testConfig = buildFinalConfig();
      const validation = await validateOllamaSetup(testConfig);
      
      if (!validation.isValid) {
        setError(`Configuration validation failed: ${validation.errors.join(', ')}`);
        setIsLoading(false);
        return;
      }
      
      if (validation.warnings.length > 0) {
        setWarnings(validation.warnings);
      }
      
      proceedToSummary();
    } catch (err) {
      setError(`Connection test failed: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const completeConfiguration = () => {
    const finalConfig = buildFinalConfig();
    onComplete(finalConfig);
  };

  const buildFinalConfig = (): OllamaConfig => mergeOllamaConfig({
    baseUrl: configState.baseUrl,
    defaultModel: configState.selectedModel,
    timeout: configState.timeout,
    maxRetries: configState.maxRetries,
    connectionTestEnabled: configState.connectionTestEnabled,
    advancedOptions: {
      temperature: configState.temperature,
      topP: configState.topP,
      maxTokens: configState.maxTokens,
      systemPrompt: configState.systemPrompt,
      customOptions: {},
    },
  });

  const renderCurrentStep = () => {
    switch (currentStep) {
      case ConfigStep.BASE_URL:
        return renderBaseUrlStep();
      case ConfigStep.MODEL_SELECTION:
        return renderModelSelectionStep();
      case ConfigStep.TIMEOUT_CONFIG:
        return renderTimeoutConfigStep();
      case ConfigStep.TESTING:
        return renderTestingStep();
      case ConfigStep.SUMMARY:
        return renderSummaryStep();
      default:
        return null;
    }
  };

  const renderBaseUrlStep = () => (
    <Box flexDirection="column">
      <Text bold>Configure Ollama Server</Text>
      <Box marginTop={1}>
        <Text>Enter the Ollama server URL (default: http://localhost:11434):</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.AccentBlue}>
          {baseUrlInput || 'http://localhost:11434'}
        </Text>
        <Text>█</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.Gray}>Press Enter to continue, Escape to cancel</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          Type to replace default, or press Enter to use default
        </Text>
      </Box>
    </Box>
  );

  const renderModelSelectionStep = () => {
    const modelItems = configState.availableModels.map(model => {
      const timeout = getModelRecommendedTimeout(model);
      return {
        label: `${model} (${(timeout / 1000).toFixed(0)}s timeout)`,
        value: model,
      };
    });

    return (
      <Box flexDirection="column">
        <Text bold>Select Ollama Model</Text>
        <Box marginTop={1}>
          <Text>Choose a model for content generation:</Text>
        </Box>
        <Box marginTop={1}>
          <RadioButtonSelect
            items={modelItems}
            initialIndex={selectedModelIndex}
            onSelect={(model) => {
              const index = configState.availableModels.indexOf(model);
              setSelectedModelIndex(index);
              proceedToTimeoutConfig();
            }}
            isFocused={true}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Use arrow keys to select, Enter to confirm</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Timeout values are automatically optimized per model</Text>
        </Box>
      </Box>
    );
  };

  const renderTimeoutConfigStep = () => {
    const recommendedTimeout = getModelRecommendedTimeout(configState.selectedModel);
    const recommendedSeconds = Math.floor(recommendedTimeout / 1000);

    return (
      <Box flexDirection="column">
        <Text bold>Configure Timeout</Text>
        <Box marginTop={1}>
          <Text>Set timeout for model "{configState.selectedModel}" (in seconds):</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={Colors.AccentBlue}>
            {timeoutInput}
          </Text>
          <Text>█</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={Colors.Gray}>
            Recommended: {recommendedSeconds}s for this model
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={Colors.Gray}>
            Type timeout in seconds (current: {timeoutInput || recommendedSeconds}s), or press Enter to confirm
          </Text>
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color={Colors.AccentRed}>{error}</Text>
          </Box>
        )}
      </Box>
    );
  };

  const renderTestingStep = () => (
    <Box flexDirection="column">
      <Text bold>Test Configuration</Text>
      <Box marginTop={1}>
        <Text>Test connection to Ollama server? (Y/n)</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.Gray}>Press Enter for Yes, &apos;n&apos; for No</Text>
      </Box>
    </Box>
  );

  const renderSummaryStep = () => (
    <Box flexDirection="column">
      <Text bold>Configuration Summary</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Server: <Text color={Colors.AccentBlue}>{configState.baseUrl}</Text></Text>
        <Text>Model: <Text color={Colors.AccentBlue}>{configState.selectedModel}</Text></Text>
        <Text>Timeout: <Text color={Colors.AccentBlue}>{(configState.timeout / 1000).toFixed(0)}s</Text></Text>
        <Text>Temperature: <Text color={Colors.AccentBlue}>{configState.temperature}</Text></Text>
        <Text>Max Tokens: <Text color={Colors.AccentBlue}>{configState.maxTokens}</Text></Text>
      </Box>
      
      {warnings.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color={Colors.AccentYellow}>Warnings:</Text>
          {warnings.map((warning, index) => (
            <Text key={index} color={Colors.AccentYellow}>• {warning}</Text>
          ))}
        </Box>
      )}
      
      <Box marginTop={1}>
        <Text>Save this configuration? (Y/n)</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.Gray}>Press Enter to save, &apos;n&apos; to cancel</Text>
      </Box>
    </Box>
  );

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Box flexDirection="column">
        {renderCurrentStep()}
        
        {isLoading && (
          <Box marginTop={1}>
            <Text color={Colors.AccentBlue}>Loading...</Text>
          </Box>
        )}
        
        {error && (
          <Box marginTop={1}>
            <Text color={Colors.AccentRed}>{error}</Text>
          </Box>
        )}
        
        {warnings.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            {warnings.map((warning, index) => (
              <Text key={index} color={Colors.AccentYellow}>⚠️  {warning}</Text>
            ))}
          </Box>
        )}
        
        <Box marginTop={1}>
          <Text color={Colors.Gray}>
            Step {Object.values(ConfigStep).indexOf(currentStep) + 1} of {Object.values(ConfigStep).length}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}