import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { getAvailableModels } from '../api/client.js';

const MODELS_FILE = path.join(process.cwd(), 'data', 'models.json');
const MODEL_USAGE_FILE = path.join(process.cwd(), 'data', 'model_usage.json');

// 默认模型配置（每日额度）
const DEFAULT_MODEL_QUOTAS = {
  'gemini-2.0-flash-exp': 100,
  'gemini-1.5-flash': 100,
  'gemini-1.5-flash-8b': 150,
  'gemini-1.5-pro': 50,
  'gemini-exp-1206': 30,
  'default': 100  // 未配置模型的默认额度
};

// 读取模型列表
export async function loadModels() {
  try {
    const data = await fs.readFile(MODELS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// 保存模型列表
async function saveModels(models) {
  const dir = path.dirname(MODELS_FILE);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(MODELS_FILE, JSON.stringify(models, null, 2), 'utf-8');
}

// 读取模型使用记录
async function loadModelUsage() {
  try {
    const data = await fs.readFile(MODEL_USAGE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

// 保存模型使用记录
async function saveModelUsage(usage) {
  const dir = path.dirname(MODEL_USAGE_FILE);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(MODEL_USAGE_FILE, JSON.stringify(usage, null, 2), 'utf-8');
}

// 自动获取并保存模型
export async function fetchAndSaveModels() {
  try {
    // 使用管理员权限获取模型列表
    const modelsData = await getAvailableModels({ type: 'admin' });

    if (!modelsData || !modelsData.data) {
      throw new Error('获取模型列表失败');
    }

    const models = modelsData.data.map(model => ({
      id: model.id,
      name: model.id,
      quota: DEFAULT_MODEL_QUOTAS[model.id] || DEFAULT_MODEL_QUOTAS.default,
      enabled: true,
      created: Date.now(),
      updated: Date.now()
    }));

    await saveModels(models);
    logger.info(`成功获取并保存了 ${models.length} 个模型`);

    return models;
  } catch (error) {
    logger.error(`获取模型失败: ${error.message}`);
    throw error;
  }
}

// 更新模型配额
export async function updateModelQuota(modelId, quota) {
  const models = await loadModels();
  const model = models.find(m => m.id === modelId);

  if (!model) {
    throw new Error('模型不存在');
  }

  model.quota = quota;
  model.updated = Date.now();

  await saveModels(models);
  logger.info(`更新模型 ${modelId} 配额为 ${quota}`);

  return model;
}

// 启用/禁用模型
export async function toggleModel(modelId, enabled) {
  const models = await loadModels();
  const model = models.find(m => m.id === modelId);

  if (!model) {
    throw new Error('模型不存在');
  }

  model.enabled = enabled;
  model.updated = Date.now();

  await saveModels(models);
  logger.info(`模型 ${modelId} 已${enabled ? '启用' : '禁用'}`);

  return model;
}

// 记录模型使用
export async function recordModelUsage(userId, modelId) {
  const usage = await loadModelUsage();
  const today = new Date().toISOString().split('T')[0];

  // 初始化用户记录
  if (!usage[userId]) {
    usage[userId] = {};
  }

  // 初始化日期记录
  if (!usage[userId][today]) {
    usage[userId][today] = {};
  }

  // 初始化模型记录
  if (!usage[userId][today][modelId]) {
    usage[userId][today][modelId] = 0;
  }

  // 增加使用次数
  usage[userId][today][modelId]++;

  await saveModelUsage(usage);
  return usage[userId][today][modelId];
}

// 获取用户今日模型使用情况
export async function getUserModelUsage(userId) {
  const usage = await loadModelUsage();
  const today = new Date().toISOString().split('T')[0];

  if (!usage[userId] || !usage[userId][today]) {
    return {};
  }

  return usage[userId][today];
}

// 检查用户模型配额
export async function checkModelQuota(userId, modelId) {
  const models = await loadModels();
  const model = models.find(m => m.id === modelId);

  if (!model) {
    // 模型不存在，使用默认配额
    const defaultQuota = DEFAULT_MODEL_QUOTAS.default;
    const usage = await getUserModelUsage(userId);
    const used = usage[modelId] || 0;

    return {
      allowed: used < defaultQuota,
      quota: defaultQuota,
      used,
      remaining: Math.max(0, defaultQuota - used)
    };
  }

  if (!model.enabled) {
    return {
      allowed: false,
      quota: model.quota,
      used: 0,
      remaining: 0,
      error: '该模型已被禁用'
    };
  }

  const usage = await getUserModelUsage(userId);
  const used = usage[modelId] || 0;

  return {
    allowed: used < model.quota,
    quota: model.quota,
    used,
    remaining: Math.max(0, model.quota - used)
  };
}

// 获取模型统计信息
export async function getModelStats() {
  const models = await loadModels();
  const usage = await loadModelUsage();
  const today = new Date().toISOString().split('T')[0];

  const stats = models.map(model => {
    let totalUsageToday = 0;
    let userCount = 0;

    // 统计今日所有用户对该模型的使用
    Object.keys(usage).forEach(userId => {
      if (usage[userId][today] && usage[userId][today][model.id]) {
        totalUsageToday += usage[userId][today][model.id];
        userCount++;
      }
    });

    return {
      id: model.id,
      name: model.name,
      quota: model.quota,
      enabled: model.enabled,
      usageToday: totalUsageToday,
      userCount,
      created: model.created
    };
  });

  return {
    models: stats,
    totalModels: models.length,
    enabledModels: models.filter(m => m.enabled).length,
    totalUsageToday: stats.reduce((sum, m) => sum + m.usageToday, 0)
  };
}

// 清理过期使用记录（保留最近30天）
export async function cleanupOldUsage() {
  const usage = await loadModelUsage();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

  let cleaned = 0;

  Object.keys(usage).forEach(userId => {
    const userDates = Object.keys(usage[userId]);
    userDates.forEach(date => {
      if (date < cutoffDateStr) {
        delete usage[userId][date];
        cleaned++;
      }
    });

    // 如果用户没有任何记录，删除用户
    if (Object.keys(usage[userId]).length === 0) {
      delete usage[userId];
    }
  });

  if (cleaned > 0) {
    await saveModelUsage(usage);
    logger.info(`清理了 ${cleaned} 条过期的模型使用记录`);
  }

  return cleaned;
}

// 设置用户特定模型配额（可选功能，覆盖默认配额）
export async function setUserModelQuota(userId, modelId, quota) {
  const USER_QUOTAS_FILE = path.join(process.cwd(), 'data', 'user_model_quotas.json');

  let userQuotas = {};
  try {
    const data = await fs.readFile(USER_QUOTAS_FILE, 'utf-8');
    userQuotas = JSON.parse(data);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (!userQuotas[userId]) {
    userQuotas[userId] = {};
  }

  userQuotas[userId][modelId] = quota;

  await fs.writeFile(USER_QUOTAS_FILE, JSON.stringify(userQuotas, null, 2), 'utf-8');
  logger.info(`为用户 ${userId} 设置模型 ${modelId} 配额为 ${quota}`);

  return { userId, modelId, quota };
}

// 获取用户特定模型配额
export async function getUserModelQuota(userId, modelId) {
  const USER_QUOTAS_FILE = path.join(process.cwd(), 'data', 'user_model_quotas.json');

  try {
    const data = await fs.readFile(USER_QUOTAS_FILE, 'utf-8');
    const userQuotas = JSON.parse(data);

    if (userQuotas[userId] && userQuotas[userId][modelId] !== undefined) {
      return userQuotas[userId][modelId];
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  // 返回默认配额
  const models = await loadModels();
  const model = models.find(m => m.id === modelId);
  return model ? model.quota : DEFAULT_MODEL_QUOTAS.default;
}
