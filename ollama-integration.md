# Ollama Integration Implementation Plan

## Executive Summary

This document outlines the detailed step-by-step plan to replace the current Google authentication system with an Ollama configuration interface for the Gemini CLI. The implementation will maintain the existing user experience while switching from cloud-based authentication to local Ollama server configuration.

## Current Architecture Analysis

### Authentication System Overview
The current system supports four authentication methods:
- **OAuth Personal (LOGIN_WITH_GOOGLE)** - OAuth 2.0 with Google for personal accounts
- **Gemini API Key (USE_GEMINI)** - Direct API key authentication  
- **Vertex AI (USE_VERTEX_AI)** - Google Cloud Vertex AI authentication
- **Cloud Shell (CLOUD_SHELL)** - Application Default Credentials in Google Cloud Shell

### Key Architecture Components
- **Configuration Management**: Centralized in `/packages/core/src/config/config.ts`
- **Authentication Dialog**: UI component in `/packages/cli/src/ui/components/AuthDialog.tsx`
- **Content Generation**: Factory pattern in `/packages/core/src/core/contentGenerator.ts`
- **API Integration**: HTTP clients and request handling in `/packages/core/src/core/`

## Ollama API Analysis

### Ollama API Characteristics
- **Base URL**: `http://localhost:11434/api/` (configurable)
- **Authentication**: None required (local server)
- **Primary Endpoints**: 
  - `/chat` for chat completions
  - `/generate` for text generation
  - `/api/tags` for model listing
- **Streaming**: Native support with JSON streaming format
- **Configuration**: Support for temperature, top_p, system prompts, etc.

### Key Differences from Google APIs
1. **No Authentication**: Ollama runs locally without API keys or OAuth
2. **Different Request Format**: Uses Ollama-specific JSON structure
3. **Model Management**: Local model pulling and management
4. **Base URL Configuration**: Need to configure endpoint (default localhost:11434)
5. **Context Parameters**: Different naming and structure for generation parameters

## Implementation Plan

### Phase 1: Core Infrastructure Changes

#### Step 1.1: Add Ollama AuthType
**Files to modify:**
- `/packages/core/src/core/contentGenerator.ts`

**Changes:**
```typescript
export enum AuthType {
  LOGIN_WITH_GOOGLE = 'LOGIN_WITH_GOOGLE',
  USE_GEMINI = 'USE_GEMINI',
  USE_VERTEX_AI = 'USE_VERTEX_AI',
  CLOUD_SHELL = 'CLOUD_SHELL',
  USE_OLLAMA = 'USE_OLLAMA',  // NEW
}
```

#### Step 1.2: Create Ollama Configuration Interface
**New file:** `/packages/core/src/config/ollamaConfig.ts`

**Purpose:** Define configuration options for Ollama integration
```typescript
export interface OllamaConfig {
  baseUrl: string;           // Default: 'http://localhost:11434'
  defaultModel: string;      // Default: 'llama3.2'
  timeout: number;           // Default: 120000 (2 minutes)
  maxRetries: number;        // Default: 3
  connectionTestEnabled: boolean; // Default: true
}

export const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  baseUrl: 'http://localhost:11434',
  defaultModel: 'llama3.2',
  timeout: 120000,
  maxRetries: 3,
  connectionTestEnabled: true,
};
```

#### Step 1.3: Update Main Configuration Class
**File to modify:** `/packages/core/src/config/config.ts`

**Changes:**
- Add `ollamaConfig` property to configuration class
- Add methods for Ollama configuration management
- Update `createContentGeneratorConfig` to handle Ollama type

### Phase 2: Ollama Content Generator Implementation

#### Step 2.1: Create Ollama HTTP Client
**New file:** `/packages/core/src/ollama/ollamaClient.ts`

**Purpose:** Handle HTTP communication with Ollama server
```typescript
export class OllamaClient {
  constructor(private config: OllamaConfig) {}
  
  async generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse>;
  async generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>>;
  async listModels(): Promise<string[]>;
  async testConnection(): Promise<boolean>;
}
```

#### Step 2.2: Create Request/Response Converters
**New file:** `/packages/core/src/ollama/ollamaConverter.ts`

**Purpose:** Convert between Gemini API format and Ollama API format
```typescript
export class OllamaConverter {
  static geminiToOllama(geminiRequest: GenerateContentParameters): OllamaRequest;
  static ollamaToGemini(ollamaResponse: OllamaResponse): GenerateContentResponse;
  static convertStreamingResponse(ollamaStream: OllamaStreamResponse): GenerateContentResponse;
}
```

#### Step 2.3: Implement Ollama Content Generator
**New file:** `/packages/core/src/ollama/ollamaContentGenerator.ts`

**Purpose:** Implement `ContentGenerator` interface for Ollama
```typescript
export class OllamaContentGenerator implements ContentGenerator {
  constructor(private client: OllamaClient, private converter: OllamaConverter) {}
  
  async generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse>;
  async generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>>;
  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;
  async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;
}
```

#### Step 2.4: Update Content Generator Factory
**File to modify:** `/packages/core/src/core/contentGenerator.ts`

**Changes:**
```typescript
export function createContentGeneratorConfig(
  authType: AuthType,
  ollamaConfig?: OllamaConfig  // NEW parameter
): ContentGeneratorConfig {
  switch (authType) {
    case AuthType.USE_OLLAMA:  // NEW case
      return {
        type: authType,
        contentGenerator: new OllamaContentGenerator(
          new OllamaClient(ollamaConfig || DEFAULT_OLLAMA_CONFIG),
          new OllamaConverter()
        ),
      };
    // ... existing cases
  }
}
```

### Phase 3: Configuration UI Updates

#### Step 3.1: Create Ollama Configuration Dialog
**New file:** `/packages/cli/src/ui/components/OllamaConfigDialog.tsx`

**Purpose:** Interactive configuration interface for Ollama settings
```typescript
interface OllamaConfigDialogProps {
  onComplete: (config: OllamaConfig) => void;
  onCancel: () => void;
  initialConfig?: OllamaConfig;
}

export function OllamaConfigDialog({ onComplete, onCancel, initialConfig }: OllamaConfigDialogProps) {
  // Interactive form for:
  // - Base URL input
  // - Model selection (with auto-discovery)
  // - Connection testing
  // - Advanced options (timeout, retries)
}
```

#### Step 3.2: Update Authentication Dialog
**File to modify:** `/packages/cli/src/ui/components/AuthDialog.tsx`

**Changes:**
- Add "Use Ollama" option to the authentication methods list
- Update the `items` array to include Ollama option
- Modify selection handling to launch Ollama configuration dialog

```typescript
const items = [
  {
    label: 'Use Ollama (Local AI)',
    value: AuthType.USE_OLLAMA,
  },
  // ... existing items (Login with Google, API Key, etc.)
];
```

#### Step 3.3: Implement Ollama Configuration Flow
**File to modify:** `/packages/cli/src/ui/components/AuthDialog.tsx`

**Changes:**
- When Ollama is selected, show configuration dialog
- Test connection to Ollama server
- Validate selected model availability
- Save configuration to user settings

### Phase 4: Settings and Validation

#### Step 4.1: Add Ollama Validation
**New file:** `/packages/core/src/config/ollamaValidation.ts`

**Purpose:** Validate Ollama configuration and connectivity
```typescript
export async function validateOllamaConfig(config: OllamaConfig): Promise<string | null> {
  // Test connection to base URL
  // Verify model availability
  // Check server response format
  // Return null if valid, error message if invalid
}
```

#### Step 4.2: Update Settings Management
**File to modify:** `/packages/cli/src/config/settings.ts`

**Changes:**
- Add Ollama configuration to settings schema
- Implement settings persistence for Ollama config
- Add validation calls for Ollama settings

#### Step 4.3: Environment Variable Support
**New environment variables to support:**
- `OLLAMA_BASE_URL`: Override default Ollama server URL
- `OLLAMA_MODEL`: Set default model
- `OLLAMA_TIMEOUT`: Set request timeout
- `OLLAMA_SKIP_CONNECTION_TEST`: Skip connectivity validation

### Phase 5: Error Handling and Retry Logic

#### Step 5.1: Ollama-Specific Error Handling
**File to modify:** `/packages/core/src/utils/retry.ts`

**Changes:**
- Add Ollama-specific error detection
- Implement retry logic for connection failures
- Handle model loading delays
- Add fallback model selection

#### Step 5.2: Connection Recovery
**New file:** `/packages/core/src/ollama/connectionManager.ts`

**Purpose:** Manage connection state and recovery
```typescript
export class OllamaConnectionManager {
  async ensureConnection(): Promise<boolean>;
  async recoverFromError(error: Error): Promise<boolean>;
  async switchToFallbackModel(): Promise<string | null>;
}
```

### Phase 6: Model Management Integration

#### Step 6.1: Model Discovery
**New file:** `/packages/core/src/ollama/modelManager.ts`

**Purpose:** Discover and manage available Ollama models
```typescript
export class OllamaModelManager {
  async listAvailableModels(): Promise<OllamaModel[]>;
  async isModelAvailable(modelName: string): Promise<boolean>;
  async suggestFallbackModel(preferredModel: string): Promise<string | null>;
}
```

#### Step 6.2: Configuration UI Model Integration
**File to modify:** `/packages/cli/src/ui/components/OllamaConfigDialog.tsx`

**Changes:**
- Auto-discover available models from Ollama server
- Provide model selection dropdown
- Show model details (size, capabilities)
- Handle model loading/pulling workflow

### Phase 7: Testing and Integration

#### Step 7.1: Unit Tests
**New test files:**
- `/packages/core/src/ollama/ollamaClient.test.ts`
- `/packages/core/src/ollama/ollamaConverter.test.ts`
- `/packages/core/src/ollama/ollamaContentGenerator.test.ts`
- `/packages/cli/src/ui/components/OllamaConfigDialog.test.tsx`

#### Step 7.2: Integration Tests
**New integration test:**
- `/integration-tests/ollama-integration.test.js`
- Test full Ollama workflow from configuration to content generation
- Mock Ollama server responses for CI/CD

#### Step 7.3: Configuration Migration
**New file:** `/packages/core/src/config/migration.ts`

**Purpose:** Handle migration from Google auth to Ollama config
- Detect existing authentication settings
- Provide migration wizard
- Preserve user preferences where applicable

### Phase 8: Documentation and User Experience

#### Step 8.1: Update CLI Help and Documentation
**Files to modify:**
- `/packages/cli/src/ui/components/Help.tsx`
- `/docs/cli/authentication.md`
- `/README.md`

**Changes:**
- Add Ollama setup instructions
- Document configuration options
- Provide troubleshooting guide

#### Step 8.2: Startup Flow Enhancement
**File to modify:** `/packages/cli/src/ui/App.tsx`

**Changes:**
- Show Ollama as primary option for new users
- Provide quick setup wizard
- Add connection status indicators

## Migration Strategy

### Backward Compatibility
- Keep existing Google authentication methods functional
- Add migration prompt for existing users
- Preserve existing settings structure

### User Migration Path
1. **Automatic Detection**: Check if user has existing Google auth
2. **Migration Prompt**: Offer to switch to Ollama with benefits explanation
3. **Guided Setup**: Step-by-step Ollama configuration
4. **Validation**: Test new setup before switching
5. **Fallback**: Option to revert to Google auth if needed

## Configuration Schema

### Updated Settings Schema
```json
{
  "selectedAuthType": "USE_OLLAMA",
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "defaultModel": "llama3.2",
    "timeout": 120000,
    "maxRetries": 3,
    "connectionTestEnabled": true,
    "advancedOptions": {
      "temperature": 0.7,
      "topP": 0.9,
      "maxTokens": 4096,
      "systemPrompt": ""
    }
  }
}
```

## File Structure Changes

### New Files
```
packages/core/src/ollama/
├── ollamaClient.ts
├── ollamaConverter.ts
├── ollamaContentGenerator.ts
├── modelManager.ts
└── connectionManager.ts

packages/core/src/config/
├── ollamaConfig.ts
├── ollamaValidation.ts
└── migration.ts

packages/cli/src/ui/components/
└── OllamaConfigDialog.tsx

packages/core/src/ollama/
├── ollamaClient.test.ts
├── ollamaConverter.test.ts
└── ollamaContentGenerator.test.ts
```

### Modified Files
```
packages/core/src/core/contentGenerator.ts
packages/core/src/config/config.ts
packages/cli/src/ui/components/AuthDialog.tsx
packages/cli/src/config/settings.ts
packages/core/src/utils/retry.ts
packages/cli/src/ui/App.tsx
packages/cli/src/ui/components/Help.tsx
```

## Implementation Timeline

### Week 1-2: Core Infrastructure
- Implement Phase 1 (AuthType and configuration)
- Implement Phase 2 (Ollama client and content generator)
- Basic functionality testing

### Week 3: UI and Configuration
- Implement Phase 3 (Configuration UI)
- Implement Phase 4 (Settings and validation)
- User experience testing

### Week 4: Polish and Integration
- Implement Phase 5 (Error handling)
- Implement Phase 6 (Model management)
- Integration testing

### Week 5: Testing and Documentation
- Implement Phase 7 (Testing)
- Implement Phase 8 (Documentation)
- User acceptance testing

### Week 6: Migration and Deployment
- Migration strategy implementation
- Backward compatibility verification
- Release preparation

## Risk Assessment and Mitigation

### Technical Risks
1. **Ollama Server Availability**: Mitigation - Connection testing and clear error messages
2. **Model Compatibility**: Mitigation - Model validation and fallback options
3. **Performance Differences**: Mitigation - Configurable timeouts and caching

### User Experience Risks
1. **Configuration Complexity**: Mitigation - Guided setup wizard and sensible defaults
2. **Migration Disruption**: Mitigation - Optional migration with fallback support
3. **Local Server Requirements**: Mitigation - Clear documentation and setup instructions

## Success Criteria

### Technical Success Criteria
- [ ] All existing CLI functionality works with Ollama backend
- [ ] Configuration UI provides intuitive setup experience
- [ ] Error handling provides clear, actionable feedback
- [ ] Performance meets or exceeds current experience
- [ ] Full test coverage for new components

### User Experience Success Criteria
- [ ] Setup time reduced from authentication to under 2 minutes
- [ ] Zero API costs for users
- [ ] Local privacy preserved (no cloud data transfer)
- [ ] Comparable or better response quality
- [ ] Smooth migration path for existing users

## Conclusion

This implementation plan provides a comprehensive roadmap for replacing the Google authentication system with a local Ollama configuration interface. The phased approach ensures minimal disruption to existing users while providing a superior experience with local AI inference, zero API costs, and enhanced privacy.

The modular architecture preserves the existing codebase structure while cleanly integrating Ollama support. The migration strategy ensures that existing users can transition smoothly while new users benefit from the simplified setup process.