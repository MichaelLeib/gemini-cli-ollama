# Ollama Tool Calling Support - Implementation Plan

## Problem Analysis

### Root Cause: Impedance Mismatch
The current naive implementation converts Gemini tool format to Ollama format without understanding the fundamental differences between the two systems:

1. **Gemini CLI Architecture**: Expects tools to be **pre-registered** with schemas, then the model selects from available tools
2. **Current Implementation**: Naively converted Gemini tool format to Ollama format without understanding execution flow
3. **Ollama Reality**: Models need **training-specific tool call formats** and **proper prompt engineering**

### Why Hallucination Occurs
1. **Wrong Format**: Each model (Qwen, Mistral, DeepSeek, K2) has different tool calling formats
2. **No Validation**: No validation that the model actually supports tools or uses the right format
3. **Missing Translation Layer**: No proper translation between Gemini's function response format and Ollama's expectations

## Solution Architecture: Translation Service Interface

Build a **model-aware translation service** that acts as a bridge between Gemini CLI and Ollama models.

```typescript
interface OllamaToolTranslationService {
  // Model detection
  detectModelCapabilities(model: string): ModelToolCapabilities;
  
  // Request translation  
  translateToolsToModel(tools: Tool[], model: string): ModelToolFormat;
  translateRequestToModel(request: GenerateContentParameters, model: string): OllamaRequest;
  
  // Response translation
  translateResponseFromModel(response: OllamaResponse, model: string): GenerateContentResponse;
  validateToolCall(toolCall: any, model: string): boolean;
  
  // Execution flow
  executeToolCallWorkflow(request: ToolCallRequest, model: String): Promise<ToolCallResponse>;
}
```

## Model-Specific Requirements

### Qwen2.5-Coder
- **Format**: Uses `qwen3coder_tool_parser.py` style
- **Requirements**: Hermes-style tool use, avoid ReAct templates  
- **Tool Format**: Standard OpenAI-compatible JSON schema
- **Limitations**: Not 100% accurate in function following
- **Best Practice**: Provide clear, detailed function descriptions

### Mistral
- **Format**: OpenAI-compatible with `tool_choice` and `parallel_tool_calls`
- **Requirements**: Explicit parameter schemas, supports parallel calls
- **Models**: mistral-large, mistral-nemo, codestral, etc.
- **Parameters**: 
  - `tool_choice`: "auto" (default), "any", "none"
  - `parallel_tool_calls`: true (default), false
- **Limitations**: Maximum function limit not specified

### DeepSeek  
- **Format**: OpenAI-compatible, up to 128 functions
- **Limitation**: Poor at multi-turn function calling
- **Best Practice**: Single user message → multiple function calls
- **Models**: deepseek-chat (V3), deepseek-reasoner (R1)
- **Note**: R1-0528 version supports system prompts, JSON output and function calling

### Kimi K2
- **Format**: OpenAI-compatible with agentic capabilities
- **Strength**: Multi-turn workflows, autonomous task orchestration
- **Usage**: High-level objectives with sub-task orchestration
- **Parameters**: 32B activated params, 1T total params, 128K context
- **Best Practice**: Structure complex tasks into clear steps

## Implementation Plan

### Phase 1: Model Detection & Capability Mapping

```typescript
interface ModelToolCapabilities {
  supportsTools: boolean;
  toolFormat: 'openai' | 'hermes' | 'custom';
  maxTools: number;
  supportsParallel: boolean;
  supportsStreaming: boolean;
  customParser?: string;
  promptStyle?: 'standard' | 'agentic' | 'hermes';
  multiTurnSupport: 'excellent' | 'good' | 'poor';
}

const MODEL_CAPABILITIES: Record<string, ModelToolCapabilities> = {
  'qwen2.5-coder:32b': {
    supportsTools: true,
    toolFormat: 'hermes',
    maxTools: 64,
    supportsParallel: true,
    supportsStreaming: true,
    customParser: 'qwen3coder',
    promptStyle: 'hermes',
    multiTurnSupport: 'good'
  },
  'mistral:latest': {
    supportsTools: true, 
    toolFormat: 'openai',
    maxTools: 128,
    supportsParallel: true,
    supportsStreaming: false,
    promptStyle: 'standard',
    multiTurnSupport: 'excellent'
  },
  'deepseek-chat': {
    supportsTools: true,
    toolFormat: 'openai', 
    maxTools: 128,
    supportsParallel: true,
    supportsStreaming: false,
    promptStyle: 'standard',
    multiTurnSupport: 'poor'
  },
  'kimi-k2': {
    supportsTools: true,
    toolFormat: 'openai',
    maxTools: 64,
    supportsParallel: true,
    supportsStreaming: true,
    promptStyle: 'agentic',
    multiTurnSupport: 'excellent'
  }
};
```

### Phase 2: Request Translation

```typescript
class OllamaToolTranslator {
  translateGeminiToolsToOllama(tools: Tool[], model: string): OllamaTool[] {
    const capabilities = this.getModelCapabilities(model);
    
    if (!capabilities.supportsTools) {
      return []; // Return empty, don't send tools
    }
    
    return tools.slice(0, capabilities.maxTools).map(tool => {
      switch (capabilities.toolFormat) {
        case 'openai':
          return this.convertToOpenAIFormat(tool);
        case 'hermes':
          return this.convertToHermesFormat(tool);
        case 'custom':
          return this.convertToCustomFormat(tool, capabilities.customParser);
      }
    });
  }
  
  private convertToOpenAIFormat(tool: Tool): OllamaTool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: {
          type: 'object',
          properties: tool.schema.parameters?.properties || {},
          required: tool.schema.parameters?.required || []
        }
      }
    };
  }

  private convertToHermesFormat(tool: Tool): OllamaTool {
    // Hermes format includes special prompting
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: `${tool.description}\n\nUse this tool when you need to ${tool.description.toLowerCase()}.`,
        parameters: {
          type: 'object',
          properties: tool.schema.parameters?.properties || {},
          required: tool.schema.parameters?.required || []
        }
      }
    };
  }
}
```

### Phase 3: Response Validation & Translation

```typescript
class OllamaResponseTranslator {
  validateAndTranslateResponse(response: OllamaChatResponse, model: string, registeredTools: Tool[]): GenerateContentResponse {
    const capabilities = this.getModelCapabilities(model);
    
    // Validate tool calls are real and not hallucinated
    if (response.message.tool_calls) {
      const validCalls = response.message.tool_calls.filter(call => 
        this.isValidToolCall(call, capabilities, registeredTools)
      );
      
      // Log hallucinated tool calls for debugging
      const hallucinated = response.message.tool_calls.length - validCalls.length;
      if (hallucinated > 0) {
        console.warn(`Filtered ${hallucinated} hallucinated tool calls from ${model}`);
      }
      
      response.message.tool_calls = validCalls;
    }
    
    return this.convertToGeminiFormat(response);
  }
  
  private isValidToolCall(toolCall: OllamaToolCall, capabilities: ModelToolCapabilities, registeredTools: Tool[]): boolean {
    // Check if tool is actually registered
    const toolExists = registeredTools.some(tool => tool.name === toolCall.function.name);
    if (!toolExists) {
      console.warn(`Model attempted to call non-existent tool: ${toolCall.function.name}`);
      return false;
    }
    
    // Validate arguments are valid JSON
    try {
      if (typeof toolCall.function.arguments === 'string') {
        JSON.parse(toolCall.function.arguments);
      }
    } catch (e) {
      console.warn(`Invalid JSON in tool call arguments: ${e.message}`);
      return false;
    }
    
    return true;
  }
}
```

### Phase 4: Model-Specific Prompt Engineering

```typescript
class ModelPromptEngineer {
  enhanceSystemPrompt(basePrompt: string, model: string, tools: Tool[]): string {
    const capabilities = this.getModelCapabilities(model);
    
    if (!capabilities.supportsTools || tools.length === 0) {
      return basePrompt;
    }
    
    switch (capabilities.promptStyle) {
      case 'hermes':
        return this.addHermesToolInstructions(basePrompt, tools);
      case 'agentic':
        return this.addAgenticToolInstructions(basePrompt, tools);
      case 'standard':
      default:
        return this.addStandardToolInstructions(basePrompt, tools);
    }
  }
  
  private addHermesToolInstructions(prompt: string, tools: Tool[]): string {
    return `${prompt}

Available tools:
${tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

Use tools by calling them in the proper format. Think step by step before calling tools.
Only call tools that are actually available in the list above.`;
  }
  
  private addAgenticToolInstructions(prompt: string, tools: Tool[]): string {
    return `${prompt}

You are an agentic AI with access to the following tools:
${tools.map(tool => `- **${tool.name}**: ${tool.description}`).join('\n')}

You can orchestrate complex tasks by breaking them into sub-tasks and using tools strategically.
Always validate that a tool exists before attempting to call it.`;
  }
  
  private addStandardToolInstructions(prompt: string, tools: Tool[]): string {
    return `${prompt}

Available functions:
${tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

Use these functions when appropriate to complete tasks. Only call functions that exist.`;
  }
}
```

### Phase 5: Integration Points

1. **Update OllamaContentGenerator**: Use translation service
2. **Modify OllamaConverter**: Add model-aware validation  
3. **Enhance OllamaClient**: Support different model formats
4. **Add Configuration**: Model capability detection

## File Structure

```
packages/core/src/ollama/
├── translation/
│   ├── OllamaToolTranslationService.ts
│   ├── ModelCapabilities.ts
│   ├── OllamaToolTranslator.ts
│   ├── OllamaResponseTranslator.ts
│   └── ModelPromptEngineer.ts
├── ollamaContentGenerator.ts (updated)
├── ollamaConverter.ts (updated)
└── ollamaClient.ts (updated)
```

## Success Criteria

This approach will **eliminate hallucination** by:
- ✅ Only sending tools to models that support them
- ✅ Using correct format for each model
- ✅ Validating responses before processing
- ✅ Providing proper prompt engineering per model
- ✅ Handling model-specific limitations
- ✅ Logging and filtering hallucinated tool calls
- ✅ Providing fallback behavior for unsupported models

## Testing Strategy

1. **Unit Tests**: Each translator component
2. **Integration Tests**: End-to-end tool calling flow
3. **Model-Specific Tests**: Test each supported model format
4. **Hallucination Detection**: Test with models that tend to hallucinate
5. **Performance Tests**: Ensure translation doesn't add significant latency

## Future Enhancements

1. **Dynamic Model Detection**: Auto-detect model capabilities via API
2. **Custom Model Support**: Allow users to define custom model capabilities
3. **Tool Call Caching**: Cache successful tool call patterns
4. **Advanced Validation**: Schema validation against tool parameters
5. **Metrics & Monitoring**: Track tool call success rates by model