import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateAssistantResponse, getAvailableModels } from '../api/client.js';
import { generateRequestBody } from '../utils/utils.js';
import { generateAntigravityRequestFromGemini } from '../utils/gemini_adapter.js';
import logger from '../utils/logger.js';
import config from '../config/config.js';
import adminRoutes, { incrementRequestCount, addLog } from '../admin/routes.js';
import { validateKey, checkRateLimit, checkBalance, deductBalance } from '../admin/key_manager.js';
import { logUsage, calculateCost } from '../admin/usage_logger.js';
import idleManager from '../utils/idle_manager.js';
import tokenManager from '../auth/token_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 确保必要的目录存在
const ensureDirectories = () => {
  const dirs = ['data', 'uploads'];
  dirs.forEach(dir => {
    const dirPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.info(`创建目录: ${dir}`);
    }
  });
};

ensureDirectories();

const app = express();

app.use(express.json({ limit: config.security.maxRequestSize }));

// 静态文件服务 - 提供管理控制台页面
app.use(express.static(path.join(process.cwd(), 'public')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: `请求体过大，最大支持 ${config.security.maxRequestSize}` });
  }
  next(err);
});

// 请求日志中间件
app.use((req, res, next) => {
  // 记录请求活动，管理空闲状态
  if (req.path.startsWith('/v1/')) {
    idleManager.recordActivity();
  }

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.request(req.method, req.path, res.statusCode, duration);

    // 记录到管理日志
    if (req.path.startsWith('/v1/')) {
      incrementRequestCount();
      addLog('info', `${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// API 密钥验证和频率限制中间件
app.use(async (req, res, next) => {
  if (req.path.startsWith('/v1')) {
    // 支持多种 header 形式：Authorization (OpenAI/标准) 和 x-goog-api-key (Gemini CLI)
    const authHeader = req.headers.authorization;
    const googApiKey = req.headers['x-goog-api-key'];
    const providedKey = googApiKey || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader);

    if (!providedKey) {
      logger.warn(`缺少 API Key: ${req.method} ${req.path}`);
      return res.status(401).json({ error: 'Missing API Key' });
    }

    // 先检查配置文件中的系统密钥（不受频率限制和余额限制）
    const systemApiKey = config.security?.apiKey;
    if (systemApiKey && providedKey === systemApiKey) {
      req.apiKey = providedKey;
      req.isSystemKey = true;
      return next();
    }

    // 检查数据库中的用户密钥
    const isValid = await validateKey(providedKey);
    if (!isValid) {
      logger.warn(`API Key 验证失败: ${req.method} ${req.path}`);
      await addLog('warn', `API Key 验证失败: ${req.method} ${req.path}`);
      return res.status(401).json({ error: 'Invalid API Key' });
    }

    // 保存API key到request对象，用于后续计费
    req.apiKey = providedKey;
    req.isSystemKey = false;

    // 检查余额
    const balanceCheck = await checkBalance(providedKey);
    if (!balanceCheck.allowed) {
      logger.warn(`余额不足: ${req.method} ${req.path} - ${balanceCheck.error}`);
      await addLog('warn', `余额不足: ${providedKey.substring(0, 10)}...`);

      return res.status(402).json({
        error: {
          message: balanceCheck.error || '余额不足',
          type: 'insufficient_balance',
          balance: balanceCheck.balance,
          maxBalance: balanceCheck.maxBalance
        }
      });
    }

    // 检查频率限制
    const rateLimitCheck = await checkRateLimit(providedKey);
    if (!rateLimitCheck.allowed) {
      logger.warn(`频率限制: ${req.method} ${req.path} - ${rateLimitCheck.error}`);
      await addLog('warn', `频率限制触发: ${providedKey.substring(0, 10)}...`);

      res.setHeader('X-RateLimit-Limit', rateLimitCheck.limit || 0);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', rateLimitCheck.resetIn || 0);

      return res.status(429).json({
        error: {
          message: rateLimitCheck.error,
          type: 'rate_limit_exceeded',
          reset_in_seconds: rateLimitCheck.resetIn
        }
      });
    }

    // 设置频率限制响应头
    if (rateLimitCheck.limit) {
      res.setHeader('X-RateLimit-Limit', rateLimitCheck.limit);
      res.setHeader('X-RateLimit-Remaining', rateLimitCheck.remaining);
    }
  }
  next();
});

// 管理路由
app.use('/admin', adminRoutes);

// 模型名称映射表
const modelAliasMap = {
  'gemini-3-pro-preview': 'gemini-3-pro-high',
  'gemini-3-pro': 'gemini-3-pro-high',
  'gemini-pro': 'gemini-2.5-pro',
  'gemini-flash': 'gemini-2.5-flash'
};

// 模型名称映射函数
function mapModelName(model) {
  const mappedModel = modelAliasMap[model];
  if (mappedModel) {
    logger.info(`🔄 模型映射: ${model} → ${mappedModel}`);
    return mappedModel;
  }
  return model;
}

app.get('/v1/models', async (req, res) => {
  try {
    const models = await getAvailableModels();
    res.json(models);
  } catch (error) {
    logger.error('获取模型列表失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/v1/chat/completions', async (req, res) => {
  let { messages, model, stream = true, tools, ...params} = req.body;
  model = mapModelName(model); // 应用模型映射
  try {

    if (!messages) {
      return res.status(400).json({ error: 'messages is required' });
    }

    const requestBody = generateRequestBody(messages, model, params, tools);
    //console.log(JSON.stringify(requestBody,null,2));
    
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const id = `chatcmpl-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      let hasToolCall = false;
      
      await generateAssistantResponse(requestBody, (data) => {
        if (data.type === 'tool_calls') {
          hasToolCall = true;
          res.write(`data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: { tool_calls: data.tool_calls }, finish_reason: null }]
          })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: { content: data.content }, finish_reason: null }]
          })}\n\n`);
        }
      });
      
      res.write(`data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: hasToolCall ? 'tool_calls' : 'stop' }]
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      let fullContent = '';
      let toolCalls = [];
      await generateAssistantResponse(requestBody, (data) => {
        if (data.type === 'tool_calls') {
          toolCalls = data.tool_calls;
        } else {
          fullContent += data.content;
        }
      });
      
      const message = { role: 'assistant', content: fullContent };
      if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
      }
      
      res.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message,
          finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
        }]
      });
    }
  } catch (error) {
    logger.error('生成响应失败:', error.message);
    if (!res.headersSent) {
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const id = `chatcmpl-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);
        res.write(`data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: { content: `错误: ${error.message}` }, finish_reason: null }]
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  }
});

// Gemini 原生 API 格式支持 - 流式
app.post('/v1beta/models/:model\\:streamGenerateContent', async (req, res) => {
  let model = req.params.model;
  model = mapModelName(model); // 应用模型映射
  try {
    // 检测Gemini CLI并使用API key作为sessionId
    const userAgent = req.headers['user-agent'] || '';
    const isGeminiCLI = userAgent.includes('GeminiCLI');

    // Gemini CLI 使用 x-goog-api-key header，不是 Authorization header
    const apiKey = req.headers['x-goog-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

    // 如果是Gemini CLI且请求体中没有sessionId，在生成请求体之前预先设置sessionId
    // 这样每个使用不同API key的用户会有独立的session
    if (isGeminiCLI && !req.body.sessionId && apiKey) {
      req.body.sessionId = `gemini-cli-${apiKey.slice(-16)}`;
      logger.info(`🔧 检测到Gemini CLI请求，基于API Key创建sessionId: gemini-cli-${apiKey.slice(-16)}`);
    }

    const requestBody = generateAntigravityRequestFromGemini(req.body, model);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 使用粘性会话机制获取 token
    const sessionId = requestBody.request?.sessionId;
    if (!sessionId) {
      throw new Error('Session ID is required');
    }

    const token = await tokenManager.getTokenForSession(sessionId);
    if (!token) {
      throw new Error('没有可用的token');
    }

    const url = config.api.url;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Host': config.api.host,
        'User-Agent': config.api.userAgent,
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData = null;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        // 无法解析错误响应
      }

      if (response.status === 403) {
        // 使用新的错误处理机制
        try {
          const newToken = await tokenManager.handleRequestError(
            { statusCode: 403, message: '该账号没有使用权限' },
            token,
            sessionId
          );
          // 如果成功获取新token，重试请求（这里简化处理，只是报错）
          const error = new Error(`该账号没有使用权限，已自动切换token`);
          error.status = 403;
          throw error;
        } catch (err) {
          const error = new Error(`该账号没有使用权限，已自动禁用`);
          error.status = 403;
          throw error;
        }
      }

      if (response.status === 429) {
        // 配额耗尽，使用新的错误处理机制
        const errorMessage = errorData?.error?.message || '请求频率过高';
        try {
          const newToken = await tokenManager.handleRequestError(
            { statusCode: 429, message: errorMessage },
            token,
            sessionId
          );
          // 如果成功获取新token，提示用户重试
          const error = new Error(`配额耗尽，已自动切换token，请重试`);
          error.status = 429;
          error.errorData = errorData;
          throw error;
        } catch (err) {
          const error = new Error(errorMessage);
          error.status = 429;
          error.errorData = errorData;
          throw error;
        }
      }

      const error = new Error(`API请求失败 (${response.status}): ${errorText}`);
      error.status = response.status;
      error.errorData = errorData;
      throw error;
    }

    // 解析并转换响应格式为标准 Gemini API 格式
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usageMetadata = null; // 收集使用量信息

    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        buffer += decoder.decode(value, { stream: !done });
      }

      // 处理完整的行
      const lines = buffer.split('\n');

      // 如果不是最后一次读取，保留最后一个可能不完整的行
      if (!done) {
        buffer = lines.pop() || '';
      } else {
        buffer = '';
      }

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const jsonStr = line.slice(6);
            const data = JSON.parse(jsonStr);

            // 解包 Antigravity 的 response 对象，转换为标准 Gemini 格式
            if (data.response) {
              // 收集使用量信息
              if (data.response.usageMetadata) {
                usageMetadata = data.response.usageMetadata;
              }
              // 标准 Gemini API 格式：直接输出 response 的内容
              res.write(`data: ${JSON.stringify(data.response)}\n\n`);
            } else {
              // 如果没有 response 包装，直接转发
              res.write(`${line}\n\n`);
            }
          } catch (e) {
            // JSON 解析失败，可能是不完整的行，先跳过
            if (done) {
              // 如果是最后一次，尝试直接转发
              res.write(`${line}\n`);
            }
          }
        } else if (line.trim()) {
          // 非 data 行，直接转发
          res.write(`${line}\n`);
        }
      }

      if (done) break;
    }

    res.end();

    // 请求完成后记录使用和计费（异步执行，不阻塞响应）
    logger.info(`[DEBUG] 计费检查 - apiKey: ${req.apiKey ? 'exists' : 'missing'}, isSystemKey: ${req.isSystemKey}, usageMetadata: ${usageMetadata ? 'exists' : 'missing'}`);
    if (req.apiKey && !req.isSystemKey && usageMetadata) {
      setImmediate(async () => {
        try {
          const inputTokens = usageMetadata.promptTokenCount || 0;
          const outputTokens = usageMetadata.candidatesTokenCount || 0;

          logger.info(`[DEBUG] 开始计费 - 模型: ${model}, 输入tokens: ${inputTokens}, 输出tokens: ${outputTokens}`);

          // 计算费用
          const cost = await calculateCost(model, inputTokens, outputTokens);

          logger.info(`[DEBUG] 费用计算结果 - cost对象:`, JSON.stringify(cost));

          // 记录使用日志
          await logUsage(req.apiKey, model, inputTokens, outputTokens, sessionId, requestBody.requestId);

          // 扣除余额
          await deductBalance(req.apiKey, cost.totalCost);

          logger.info(`✅ 计费完成: Key ${req.apiKey.substring(0, 10)}..., $${cost.totalCost.toFixed(6)}`);
        } catch (error) {
          logger.error('计费失败:', error.message);
          logger.error('计费错误详情:', error.stack);
        }
      });
    }
  } catch (error) {
    logger.error('Gemini API 请求失败:', error.message);
    if (!res.headersSent) {
      const statusCode = error.status || 500;
      const statusText = statusCode === 429 ? 'RESOURCE_EXHAUSTED' :
                        statusCode === 403 ? 'PERMISSION_DENIED' :
                        'INTERNAL';

      res.status(statusCode).json({
        error: {
          message: error.message,
          code: statusCode,
          status: statusText,
          ...(error.errorData?.error || {})
        }
      });
    }
  }
});

// Gemini 原生 API 格式支持 - 非流式
app.post('/v1beta/models/:model\\:generateContent', async (req, res) => {
  let model = req.params.model;
  model = mapModelName(model); // 应用模型映射
  try {
    const requestBody = generateAntigravityRequestFromGemini(req.body, model);

    // 直接获取 token 并调用 API
    const token = await tokenManager.getToken();
    if (!token) {
      throw new Error('没有可用的token');
    }

    const url = config.api.url;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Host': config.api.host,
        'User-Agent': config.api.userAgent,
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData = null;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        // 无法解析错误响应
      }

      if (response.status === 403) {
        // 使用新的错误处理机制
        try {
          const newToken = await tokenManager.handleRequestError(
            { statusCode: 403, message: '该账号没有使用权限' },
            token,
            sessionId
          );
          // 如果成功获取新token，重试请求（这里简化处理，只是报错）
          const error = new Error(`该账号没有使用权限，已自动切换token`);
          error.status = 403;
          throw error;
        } catch (err) {
          const error = new Error(`该账号没有使用权限，已自动禁用`);
          error.status = 403;
          throw error;
        }
      }

      if (response.status === 429) {
        // 配额耗尽，使用新的错误处理机制
        const errorMessage = errorData?.error?.message || '请求频率过高';
        try {
          const newToken = await tokenManager.handleRequestError(
            { statusCode: 429, message: errorMessage },
            token,
            sessionId
          );
          // 如果成功获取新token，提示用户重试
          const error = new Error(`配额耗尽，已自动切换token，请重试`);
          error.status = 429;
          error.errorData = errorData;
          throw error;
        } catch (err) {
          const error = new Error(errorMessage);
          error.status = 429;
          error.errorData = errorData;
          throw error;
        }
      }

      const error = new Error(`API请求失败 (${response.status}): ${errorText}`);
      error.status = response.status;
      error.errorData = errorData;
      throw error;
    }

    // 收集所有 SSE 事件并组合成最终响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let finalResponse = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

      for (const line of lines) {
        const jsonStr = line.slice(6);
        try {
          const data = JSON.parse(jsonStr);
          if (data.response) {
            finalResponse = data.response;
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }

    if (finalResponse) {
      res.json(finalResponse);
    } else {
      throw new Error('未收到有效响应');
    }
  } catch (error) {
    logger.error('Gemini API 请求失败:', error.message);
    const statusCode = error.status || 500;
    const statusText = statusCode === 429 ? 'RESOURCE_EXHAUSTED' :
                      statusCode === 403 ? 'PERMISSION_DENIED' :
                      'INTERNAL';

    res.status(statusCode).json({
      error: {
        message: error.message,
        code: statusCode,
        status: statusText,
        ...(error.errorData?.error || {})
      }
    });
  }
});

const server = app.listen(config.server.port, config.server.host, () => {
  logger.info(`服务器已启动: ${config.server.host}:${config.server.port}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`端口 ${config.server.port} 已被占用`);
    process.exit(1);
  } else if (error.code === 'EACCES') {
    logger.error(`端口 ${config.server.port} 无权限访问`);
    process.exit(1);
  } else {
    logger.error('服务器启动失败:', error.message);
    process.exit(1);
  }
});

const shutdown = () => {
  logger.info('正在关闭服务器...');

  // 清理空闲管理器
  idleManager.destroy();

  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

