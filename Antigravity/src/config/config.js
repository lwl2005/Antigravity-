import fs from 'fs';
import log from '../utils/logger.js';

const defaultConfig = {
  server: { port: 8045, host: '127.0.0.1' },
  api: {
    url: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse',
    modelsUrl: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
    host: 'daily-cloudcode-pa.sandbox.googleapis.com',
    userAgent: 'antigravity/1.11.3 windows/amd64'
  },
  defaults: { temperature: 1, top_p: 0.85, top_k: 50, max_tokens: 8096 },
  security: { maxRequestSize: '50mb', apiKey: null, adminPassword: 'admin123' },
  systemInstruction: '你是聊天机器人，专门为用户提供聊天和情绪价值，协助进行小说创作或者角色扮演，也可以提供数学或者代码上的建议',
  oauth: {
    clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
    clientSecret: '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'
  }
};

let config;

// 加载配置文件
function loadConfig() {
  try {
    const newConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
    // 确保 oauth 配置存在
    if (!newConfig.oauth) {
      newConfig.oauth = defaultConfig.oauth;
    }
    return newConfig;
  } catch {
    return { ...defaultConfig };
  }
}

// 初始加载
config = loadConfig();
log.info('✓ 配置文件加载成功');

// 重新加载配置（热更新）
export function reloadConfig() {
  const newConfig = loadConfig();
  Object.assign(config, newConfig);
  log.info('✓ 配置文件已重新加载');
  return config;
}

export default config;
