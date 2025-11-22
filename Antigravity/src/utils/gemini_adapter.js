import { generateRequestId, generateSessionId, generateProjectId } from './utils.js';
import config from '../config/config.js';

/**
 * 将 Gemini 原生格式的 contents 转换为 Antigravity 格式的 messages
 */
function geminiContentsToAntigravity(contents) {
  const antigravityMessages = [];

  for (const content of contents) {
    const role = content.role === 'user' ? 'user' : 'model';
    const parts = [];

    for (const part of content.parts) {
      // 保留所有原始字段，包括 thought_signature
      // 使用扩展运算符确保不遗漏任何字段
      parts.push({ ...part });
    }

    antigravityMessages.push({ role, parts });
  }

  return antigravityMessages;
}

/**
 * 将 Gemini 的 tools 转换为 Antigravity 格式
 */
function geminiToolsToAntigravity(tools) {
  if (!tools || tools.length === 0) return [];

  return tools.map(tool => {
    if (tool.functionDeclarations) {
      // 清理每个 functionDeclaration，移除不兼容的字段
      const cleanedDeclarations = tool.functionDeclarations.map(decl => {
        const cleaned = { ...decl };

        // Antigravity 不接受 $schema 字段
        if (cleaned.parameters && cleaned.parameters.$schema) {
          delete cleaned.parameters.$schema;
        }

        return cleaned;
      });

      return {
        functionDeclarations: cleanedDeclarations
      };
    }
    return tool;
  });
}

/**
 * 生成 Antigravity 请求体（从 Gemini 格式）
 */
export function generateAntigravityRequestFromGemini(geminiRequest, modelName) {
  const enableThinking = modelName.endsWith('-thinking') ||
    modelName === 'gemini-2.5-pro' ||
    modelName.startsWith('gemini-3-pro-') ||
    modelName === "rev19-uic3-1p" ||
    modelName === "gpt-oss-120b-medium";

  const generationConfig = geminiRequest.generationConfig || {};

  const antigravityConfig = {
    topP: generationConfig.topP ?? config.defaults.top_p,
    topK: generationConfig.topK ?? config.defaults.top_k,
    temperature: generationConfig.temperature ?? config.defaults.temperature,
    candidateCount: 1,
    maxOutputTokens: generationConfig.maxOutputTokens ?? config.defaults.max_tokens,
    stopSequences: generationConfig.stopSequences || [
      "<|user|>",
      "<|bot|>",
      "<|context_request|>",
      "<|endoftext|>",
      "<|end_of_turn|>"
    ],
    thinkingConfig: {
      includeThoughts: enableThinking,
      thinkingBudget: enableThinking ? 1024 : 0
    }
  };

  if (enableThinking && modelName.includes("claude")) {
    delete antigravityConfig.topP;
  }

  return {
    project: generateProjectId(),
    requestId: generateRequestId(),
    request: {
      contents: geminiContentsToAntigravity(geminiRequest.contents || []),
      systemInstruction: geminiRequest.systemInstruction || {
        role: "user",
        parts: [{ text: config.systemInstruction }]
      },
      tools: geminiToolsToAntigravity(geminiRequest.tools || []),
      toolConfig: geminiRequest.toolConfig || {
        functionCallingConfig: {
          mode: "VALIDATED"
        }
      },
      generationConfig: antigravityConfig,
      sessionId: geminiRequest.sessionId || generateSessionId()
    },
    model: modelName,
    userAgent: "antigravity"
  };
}

/**
 * 将 Antigravity 的 SSE 响应转换为 Gemini 格式
 */
export function convertAntigravityToGeminiSSE(data) {
  // Antigravity 的响应已经是 Gemini 格式，直接返回
  return data;
}
