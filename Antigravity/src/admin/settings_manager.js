import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { reloadConfig } from '../config/config.js';

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

// 加载设置
export async function loadSettings() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('读取配置文件失败:', error);
    // 返回默认配置
    return {
      server: { port: 8045, host: '0.0.0.0' },
      api: {
        url: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse',
        modelsUrl: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
        host: 'daily-cloudcode-pa.sandbox.googleapis.com',
        userAgent: 'antigravity/1.11.3 windows/amd64'
      },
      defaults: { temperature: 1, top_p: 0.85, top_k: 50, max_tokens: 8096 },
      security: { maxRequestSize: '50mb', apiKey: 'sk-text', adminPassword: 'admin123' },
      systemInstruction: '你是聊天机器人，专门为用户提供聊天和情绪价值，协助进行小说创作或者角色扮演，也可以提供数学或者代码上的建议'
    };
  }
}

// 保存设置
export async function saveSettings(newSettings) {
  try {
    // 读取现有配置
    let config;
    try {
      const data = await fs.readFile(CONFIG_FILE, 'utf-8');
      config = JSON.parse(data);
    } catch {
      config = {};
    }

    // 合并设置
    config.server = config.server || {};
    config.security = config.security || {};
    config.defaults = config.defaults || {};

    // 更新服务器配置
    if (newSettings.server) {
      if (newSettings.server.port !== undefined) {
        config.server.port = parseInt(newSettings.server.port) || config.server.port;
      }
      if (newSettings.server.host !== undefined) {
        config.server.host = newSettings.server.host;
      }
    }

    // 更新安全配置
    if (newSettings.security) {
      // 使用 !== undefined 判断，允许保存空字符串
      if (newSettings.security.apiKey !== undefined) {
        config.security.apiKey = newSettings.security.apiKey;
      }
      if (newSettings.security.adminPassword !== undefined) {
        config.security.adminPassword = newSettings.security.adminPassword;
      }
      if (newSettings.security.maxRequestSize !== undefined) {
        config.security.maxRequestSize = newSettings.security.maxRequestSize;
      }
    }

    // 更新默认参数
    if (newSettings.defaults) {
      config.defaults.temperature = parseFloat(newSettings.defaults.temperature) ?? config.defaults.temperature;
      config.defaults.top_p = parseFloat(newSettings.defaults.top_p) ?? config.defaults.top_p;
      config.defaults.top_k = parseInt(newSettings.defaults.top_k) ?? config.defaults.top_k;
      config.defaults.max_tokens = parseInt(newSettings.defaults.max_tokens) ?? config.defaults.max_tokens;
    }

    // 更新系统指令
    if (newSettings.systemInstruction !== undefined) {
      config.systemInstruction = newSettings.systemInstruction;
    }

    // 更新 OAuth 配置
    if (newSettings.oauth) {
      config.oauth = config.oauth || {};
      if (newSettings.oauth.clientId !== undefined) {
        config.oauth.clientId = newSettings.oauth.clientId;
      }
      if (newSettings.oauth.clientSecret !== undefined) {
        config.oauth.clientSecret = newSettings.oauth.clientSecret;
      }
    }

    // 写入文件
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    logger.info('配置文件已保存');

    // 热更新内存中的配置
    reloadConfig();

    return { success: true, message: '设置已保存并生效' };
  } catch (error) {
    logger.error('保存配置文件失败:', error);
    throw new Error('保存配置失败: ' + error.message);
  }
}
