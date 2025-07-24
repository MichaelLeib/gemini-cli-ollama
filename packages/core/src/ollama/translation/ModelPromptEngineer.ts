/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tool } from '@google/genai';
import { ModelToolCapabilities, getModelCapabilities } from './ModelCapabilities.js';

/**
 * Engineers prompts for optimal tool calling with different Ollama models
 */
export class ModelPromptEngineer {
  /**
   * Enhance system prompt with model-specific tool calling instructions
   */
  enhanceSystemPrompt(basePrompt: string, modelName: string, tools: Tool[]): string {
    const capabilities = getModelCapabilities(modelName);
    
    if (!capabilities.supportsTools || tools.length === 0) {
      return basePrompt;
    }
    
    const toolInstructions = this.generateToolInstructions(tools, capabilities, modelName);
    
    return `${basePrompt}

${toolInstructions}`;
  }
  
  /**
   * Generate tool-specific instructions based on model capabilities
   */
  private generateToolInstructions(tools: Tool[], capabilities: ModelToolCapabilities, modelName: string): string {
    switch (capabilities.promptStyle) {
      case 'hermes':
        return this.generateHermesInstructions(tools, capabilities, modelName);
      case 'agentic':
        return this.generateAgenticInstructions(tools, capabilities, modelName);
      case 'standard':
      default:
        return this.generateStandardInstructions(tools, capabilities, modelName);
    }
  }
  
  /**
   * Generate Hermes-style instructions (for Qwen models)
   */
  private generateHermesInstructions(tools: Tool[], capabilities: ModelToolCapabilities, modelName: string): string {
    const toolList = this.extractToolList(tools);
    
    let instructions = `## Available Tools

You have access to the following tools:
${toolList.map(tool => `- **${tool.name}**: ${tool.description}`).join('\n')}

## Tool Usage Guidelines

1. **Think Step by Step**: Before calling any tool, think through what you need to accomplish
2. **Use Tools Strategically**: Only call tools when they are necessary to complete the task
3. **Validate Tool Existence**: Only call tools that are listed above - do not hallucinate tool names
4. **Proper Format**: Use the exact tool names and follow the expected parameter format`;
    
    if (capabilities.customParser === 'qwen3coder') {
      instructions += `
5. **Qwen-Specific**: Use clear, descriptive reasoning before tool calls
6. **Avoid ReAct Patterns**: Do not use action/observation loops that might trigger stop words`;
    }
    
    if (!capabilities.supportsParallel) {
      instructions += `
7. **Sequential Execution**: Call tools one at a time, not in parallel`;
    }
    
    if (capabilities.maxTools < tools.length) {
      instructions += `
8. **Tool Limit**: You can use up to ${capabilities.maxTools} tools per request`;
    }
    
    return instructions;
  }
  
  /**
   * Generate agentic instructions (for Kimi K2)
   */
  private generateAgenticInstructions(tools: Tool[], capabilities: ModelToolCapabilities, modelName: string): string {
    const toolList = this.extractToolList(tools);
    
    let instructions = `## Agentic Tool Usage

You are an autonomous AI agent with access to powerful tools. Use them strategically to accomplish complex tasks.

### Available Tools:
${toolList.map(tool => `- **${tool.name}**: ${tool.description}`).join('\n')}

### Agentic Principles:
1. **High-Level Planning**: Break complex tasks into manageable sub-tasks
2. **Tool Orchestration**: Use multiple tools in sequence to achieve objectives
3. **Autonomous Decision Making**: Decide which tools to use and when
4. **Error Recovery**: If a tool call fails, adapt your approach
5. **Goal-Oriented**: Keep the end objective in mind throughout execution`;
    
    if (capabilities.config?.recommendedContextSize) {
      instructions += `
6. **Context Awareness**: Leverage the ${capabilities.config.recommendedContextSize} token context window for complex reasoning`;
    }
    
    instructions += `

### Multi-Turn Workflow:
- You excel at multi-turn conversations and complex task orchestration
- Feel free to use multiple tools across several interactions
- Maintain context and build upon previous tool results`;
    
    return instructions;
  }
  
  /**
   * Generate standard instructions (for Mistral, DeepSeek, etc.)
   */
  private generateStandardInstructions(tools: Tool[], capabilities: ModelToolCapabilities, modelName: string): string {
    const toolList = this.extractToolList(tools);
    
    let instructions = `## Function Calling

Available functions:
${toolList.map(tool => `- **${tool.name}**: ${tool.description}`).join('\n')}

## Usage Rules:
1. Only call functions that are listed above
2. Use proper JSON formatting for function arguments
3. Do not hallucinate or invent function names`;
    
    if (capabilities.supportsParallel) {
      instructions += `
4. You can call multiple functions in parallel when appropriate`;
    } else {
      instructions += `
4. Call functions one at a time (parallel calls not supported)`;
    }
    
    if (capabilities.config?.requiresExplicitToolChoice) {
      instructions += `
5. Be explicit about when you need to use tools vs. providing direct responses`;
    }
    
    // Model-specific adjustments
    if (modelName.includes('deepseek')) {
      instructions += `

## DeepSeek-Specific Notes:
- Prefer making multiple function calls in a single turn rather than multiple turns
- Focus on completing the task efficiently with minimal back-and-forth`;
    }
    
    if (modelName.includes('mistral')) {
      instructions += `

## Mistral-Specific Notes:
- Provide clear reasoning for why you're calling specific functions
- Use detailed function descriptions to guide your decisions`;
    }
    
    return instructions;
  }
  
  /**
   * Extract tool information for prompt generation
   */
  private extractToolList(tools: Tool[]): Array<{name: string, description: string}> {
    const toolList: Array<{name: string, description: string}> = [];
    
    for (const tool of tools) {
      if ('functionDeclarations' in tool && tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          toolList.push({
            name: func.name ?? 'unnamed_function',
            description: func.description ?? 'No description available'
          });
        }
      }
    }
    
    return toolList;
  }
  
  /**
   * Generate model-specific user message enhancement
   */
  enhanceUserMessage(userMessage: string, modelName: string, availableTools: Tool[]): string {
    const capabilities = getModelCapabilities(modelName);
    
    if (!capabilities.supportsTools || availableTools.length === 0) {
      return userMessage;
    }
    
    // Model-specific user message enhancement
    if (capabilities.promptStyle === 'agentic') {
      return this.enhanceForAgenticModel(userMessage, capabilities);
    }
    
    if (capabilities.multiTurnSupport === 'poor') {
      return this.enhanceForPoorMultiTurn(userMessage, capabilities);
    }
    
    return userMessage;
  }
  
  /**
   * Enhance user message for agentic models
   */
  private enhanceForAgenticModel(userMessage: string, capabilities: ModelToolCapabilities): string {
    // For agentic models, encourage high-level thinking
    const enhancement = `Please approach this task autonomously using available tools as needed: ${userMessage}`;
    return enhancement;
  }
  
  /**
   * Enhance user message for models with poor multi-turn support
   */
  private enhanceForPoorMultiTurn(userMessage: string, capabilities: ModelToolCapabilities): string {
    // For models like DeepSeek, encourage comprehensive single-turn responses
    const enhancement = `${userMessage}

Please complete this task as thoroughly as possible in your response, using any necessary tools.`;
    return enhancement;
  }
  
  /**
   * Generate context-aware tool selection guidance
   */
  generateToolSelectionGuidance(availableTools: Tool[], taskContext: string, modelName: string): string {
    const capabilities = getModelCapabilities(modelName);
    const toolList = this.extractToolList(availableTools);
    
    let guidance = `For the task "${taskContext}", consider these available tools:\n`;
    
    // Prioritize tools based on task context
    const relevantTools = this.prioritizeToolsForTask(toolList, taskContext);
    
    relevantTools.forEach((tool, index) => {
      guidance += `${index + 1}. **${tool.name}**: ${tool.description}`;
      if (tool.relevanceScore > 0.7) {
        guidance += ' (Highly relevant)';
      }
      guidance += '\n';
    });
    
    // Add model-specific selection advice
    if (capabilities.maxTools < availableTools.length) {
      guidance += `\nNote: Choose the most relevant ${capabilities.maxTools} tools for this task.`;
    }
    
    return guidance;
  }
  
  /**
   * Prioritize tools based on task context using simple keyword matching
   */
  private prioritizeToolsForTask(tools: Array<{name: string, description: string}>, taskContext: string): Array<{name: string, description: string, relevanceScore: number}> {
    const taskWords = taskContext.toLowerCase().split(/\s+/);
    
    return tools.map(tool => {
      const toolText = `${tool.name} ${tool.description}`.toLowerCase();
      const matchCount = taskWords.filter(word => toolText.includes(word)).length;
      const relevanceScore = matchCount / taskWords.length;
      
      return { ...tool, relevanceScore };
    }).sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
  
  /**
   * Generate error recovery instructions for models
   */
  generateErrorRecoveryInstructions(modelName: string): string {
    const capabilities = getModelCapabilities(modelName);
    
    let instructions = `## Error Recovery

If a tool call fails:
1. Check that the tool name exists in the available tools list
2. Verify that all required parameters are provided
3. Ensure parameter values are in the correct format`;
    
    if (capabilities.multiTurnSupport === 'poor') {
      instructions += `
4. For DeepSeek models: Try alternative approaches in the same response rather than asking for clarification`;
    } else {
      instructions += `
4. Ask for clarification or try alternative approaches if needed`;
    }
    
    if (capabilities.promptStyle === 'agentic') {
      instructions += `
5. Adapt your strategy autonomously and continue working toward the goal`;
    }
    
    return instructions;
  }
}