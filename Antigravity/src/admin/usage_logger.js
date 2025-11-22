import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { getModelPricing } from './pricing_manager.js';

const USAGE_LOG_FILE = path.join(process.cwd(), 'data', 'usage_logs.json');

// 确保数据目录存在
async function ensureDataDir() {
  const dataDir = path.dirname(USAGE_LOG_FILE);
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

// 加载使用日志
export async function loadUsageLogs() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(USAGE_LOG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) {
      return [];
    }
    throw error;
  }
}

// 保存使用日志
async function saveUsageLogs(logs) {
  await ensureDataDir();
  await fs.writeFile(USAGE_LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');
}

// 计算费用（使用动态定价配置）
export async function calculateCost(model, inputTokens, outputTokens) {
  const pricing = await getModelPricing(model);
  const inputCost = (inputTokens / 1000000) * pricing.input;
  const outputCost = (outputTokens / 1000000) * pricing.output;
  const totalCost = inputCost + outputCost;

  return {
    inputCost: parseFloat(inputCost.toFixed(6)),
    outputCost: parseFloat(outputCost.toFixed(6)),
    totalCost: parseFloat(totalCost.toFixed(6))
  };
}

// 记录使用日志
export async function logUsage(keyId, model, inputTokens, outputTokens, sessionId = null, requestId = null) {
  const logs = await loadUsageLogs();

  const cost = await calculateCost(model, inputTokens, outputTokens);

  const logEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    timestamp: new Date().toISOString(),
    keyId,
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost: cost.totalCost,
    inputCost: cost.inputCost,
    outputCost: cost.outputCost,
    sessionId,
    requestId
  };

  logs.push(logEntry);

  // 保留最近10000条日志，避免文件过大
  if (logs.length > 10000) {
    logs.splice(0, logs.length - 10000);
  }

  await saveUsageLogs(logs);
  logger.info(`记录消费: Key ${keyId.substring(0, 10)}..., 模型: ${model}, Token: ${inputTokens}+${outputTokens}, 费用: $${cost.totalCost.toFixed(6)}`);

  return logEntry;
}

// 根据API key查询使用日志
export async function getUsageByKey(keyId, limit = 100, offset = 0) {
  const logs = await loadUsageLogs();
  const filtered = logs.filter(log => log.keyId === keyId);

  // 按时间倒序排列
  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // 分页
  const paginatedLogs = filtered.slice(offset, offset + limit);

  return {
    logs: paginatedLogs,
    total: filtered.length,
    totalCost: filtered.reduce((sum, log) => sum + log.cost, 0)
  };
}

// 获取API key的使用统计
export async function getUsageStats(keyId) {
  const logs = await loadUsageLogs();
  const filtered = logs.filter(log => log.keyId === keyId);

  if (filtered.length === 0) {
    return {
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      averageCost: 0
    };
  }

  const totalCost = filtered.reduce((sum, log) => sum + log.cost, 0);
  const totalInputTokens = filtered.reduce((sum, log) => sum + log.inputTokens, 0);
  const totalOutputTokens = filtered.reduce((sum, log) => sum + log.outputTokens, 0);

  return {
    totalRequests: filtered.length,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    totalCost: parseFloat(totalCost.toFixed(6)),
    averageCost: parseFloat((totalCost / filtered.length).toFixed(6))
  };
}

// 清理旧日志（清理指定天数之前的日志）
export async function cleanOldLogs(days = 30) {
  const logs = await loadUsageLogs();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const filtered = logs.filter(log => new Date(log.timestamp) >= cutoffDate);
  const removed = logs.length - filtered.length;

  await saveUsageLogs(filtered);
  logger.info(`清理了 ${removed} 条 ${days} 天前的使用日志`);

  return { removed, remaining: filtered.length };
}
