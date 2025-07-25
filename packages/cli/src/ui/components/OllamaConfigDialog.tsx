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

interface OllamaConfigDialogProps {
  onComplete: (config: OllamaConfig) => void;
  onCancel: () => void;
  initialConfig?: Partial<OllamaConfig>;
}

enum ConfigStep {
  BASE_URL = 'baseUrl',
  MODEL_SELECTION = 'modelSelection',
  ADVANCED_OPTIONS = 'advancedOptions',
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
  const [advancedOptionsIndex, setAdvancedOptionsIndex] = useState(0);

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
      case ConfigStep.ADVANCED_OPTIONS:
        handleAdvancedOptionsInput(input, key);
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

  const handleAdvancedOptionsInput = (input: string, key: {return?: boolean}) => {
    if (key.return) {
      if (advancedOptionsIndex === 0) {
        // Skip advanced options
        proceedToTesting();
      } else {
        // Configure advanced options (simplified for now)
        proceedToTesting();
      }
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

  const proceedToAdvancedOptions = () => {
    const selectedModel = configState.availableModels[selectedModelIndex];
    setConfigState(prev => ({ ...prev, selectedModel }));
    setCurrentStep(ConfigStep.ADVANCED_OPTIONS);
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
      case ConfigStep.ADVANCED_OPTIONS:
        return renderAdvancedOptionsStep();
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
    const modelItems = configState.availableModels.map(model => ({
      label: model,
      value: model,
    }));

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
              proceedToAdvancedOptions();
            }}
            isFocused={true}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Use arrow keys to select, Enter to confirm</Text>
        </Box>
      </Box>
    );
  };

  const renderAdvancedOptionsStep = () => {
    const optionItems = [
      { label: 'Use default settings (recommended)', value: 'default' },
      { label: 'Configure advanced options', value: 'advanced' },
    ];

    return (
      <Box flexDirection="column">
        <Text bold>Advanced Configuration</Text>
        <Box marginTop={1}>
          <Text>Would you like to configure advanced options?</Text>
        </Box>
        <Box marginTop={1}>
          <RadioButtonSelect
            items={optionItems}
            initialIndex={advancedOptionsIndex}
            onSelect={(value) => {
              setAdvancedOptionsIndex(value === 'default' ? 0 : 1);
              proceedToTesting();
            }}
            isFocused={true}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={Colors.Gray}>
            Default: Temperature 0.7, Top-p 0.9, Max tokens 4096
          </Text>
        </Box>
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