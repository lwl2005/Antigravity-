import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import logger from '../utils/logger.js';

const KEYS_FILE = path.join(process.cwd(), 'data', 'api_keys.json');

// 确保数据目录存在
async function ensureDataDir() {
  const dataDir = path.dirname(KEYS_FILE);
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

// 生成随机 API 密钥
function generateApiKey() {
  return 'sk-' + crypto.randomBytes(32).toString('hex');
}

// 加载所有密钥
export async function loadKeys() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(KEYS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// 保存密钥
async function saveKeys(keys) {
  await ensureDataDir();
  await fs.writeFile(KEYS_FILE, JSON.stringify(keys, null, 2), 'utf-8');
}

// 创建新密钥
export async function createKey(name = '未命名', rateLimit = null, maxBalance = null) {
  const keys = await loadKeys();
  const newKey = {
    key: generateApiKey(),
    name,
    created: new Date().toISOString(),
    lastUsed: null,
    requests: 0,
    rateLimit: rateLimit || { enabled: false, maxRequests: 100, windowMs: 60000 }, // 默认 100 次/分钟
    usage: {}, // 用于存储使用记录 { timestamp: count }
    // 计费相关
    balance: maxBalance || 0, // 当前余额（美元）
    maxBalance: maxBalance || 10, // 费用上限（美元），默认10美元
    totalSpent: 0, // 总消费（美元）
    isUnlimited: maxBalance === null || maxBalance === -1 // 无限额度
  };
  keys.push(newKey);
  await saveKeys(keys);
  logger.info(`新密钥已创建: ${name}, 额度: ${maxBalance === null || maxBalance === -1 ? '无限' : '$' + maxBalance}`);
  return newKey;
}

// 删除密钥
export async function deleteKey(keyToDelete) {
  const keys = await loadKeys();
  const filtered = keys.filter(k => k.key !== keyToDelete);
  if (filtered.length === keys.length) {
    throw new Error('密钥不存在');
  }
  await saveKeys(filtered);
  logger.info(`密钥已删除: ${keyToDelete.substring(0, 10)}...`);
  return true;
}

// 验证密钥
export async function validateKey(keyToCheck) {
  const keys = await loadKeys();
  const key = keys.find(k => k.key === keyToCheck);
  if (key) {
    // 更新使用信息
    key.lastUsed = new Date().toISOString();
    key.requests = (key.requests || 0) + 1;
    await saveKeys(keys);
    return true;
  }
  return false;
}

// 获取密钥统计
export async function getKeyStats() {
  const keys = await loadKeys();
  return {
    total: keys.length,
    active: keys.filter(k => k.lastUsed).length,
    totalRequests: keys.reduce((sum, k) => sum + (k.requests || 0), 0)
  };
}

// 更新密钥频率限制
export async function updateKeyRateLimit(keyToUpdate, rateLimit) {
  const keys = await loadKeys();
  const key = keys.find(k => k.key === keyToUpdate);
  if (!key) {
    throw new Error('密钥不存在');
  }
  key.rateLimit = rateLimit;
  await saveKeys(keys);
  logger.info(`密钥频率限制已更新: ${keyToUpdate.substring(0, 10)}...`);
  return key;
}

// 检查频率限制
export async function checkRateLimit(keyToCheck) {
  const keys = await loadKeys();
  const key = keys.find(k => k.key === keyToCheck);

  if (!key) {
    return { allowed: false, error: '密钥不存在' };
  }

  // 如果未启用频率限制，直接允许
  if (!key.rateLimit || !key.rateLimit.enabled) {
    return { allowed: true };
  }

  const now = Date.now();
  const windowMs = key.rateLimit.windowMs || 60000;
  const maxRequests = key.rateLimit.maxRequests || 100;

  // 清理过期的使用记录
  key.usage = key.usage || {};
  const cutoffTime = now - windowMs;

  // 计算当前时间窗口内的请求数
  let requestCount = 0;
  for (const [timestamp, count] of Object.entries(key.usage)) {
    if (parseInt(timestamp) >= cutoffTime) {
      requestCount += count;
    } else {
      delete key.usage[timestamp]; // 清理过期记录
    }
  }

  // 检查是否超过限制
  if (requestCount >= maxRequests) {
    const resetTime = Math.min(...Object.keys(key.usage).map(t => parseInt(t))) + windowMs;
    const waitSeconds = Math.ceil((resetTime - now) / 1000);
    return {
      allowed: false,
      error: '请求频率超限',
      resetIn: waitSeconds,
      limit: maxRequests,
      remaining: 0
    };
  }

  // 记录本次请求
  const minute = Math.floor(now / 10000) * 10000; // 按10秒分组
  key.usage[minute] = (key.usage[minute] || 0) + 1;

  await saveKeys(keys);

  return {
    allowed: true,
    limit: maxRequests,
    remaining: maxRequests - requestCount - 1
  };
}

// ========== 计费相关功能 ==========

// 根据key获取完整信息
export async function getKey(keyToFind) {
  const keys = await loadKeys();
  return keys.find(k => k.key === keyToFind);
}

// 检查余额是否足够
export async function checkBalance(keyToCheck) {
  const key = await getKey(keyToCheck);
  if (!key) {
    return { allowed: false, error: '密钥不存在' };
  }

  // 无限额度的key直接允许
  if (key.isUnlimited) {
    return { allowed: true, unlimited: true };
  }

  // 检查余额是否充足
  if (key.balance <= 0) {
    return {
      allowed: false,
      error: '余额不足',
      balance: key.balance,
      maxBalance: key.maxBalance
    };
  }

  return {
    allowed: true,
    balance: key.balance,
    maxBalance: key.maxBalance
  };
}

// 扣除余额
export async function deductBalance(keyToUpdate, amount) {
  const keys = await loadKeys();
  const key = keys.find(k => k.key === keyToUpdate);

  if (!key) {
    throw new Error('密钥不存在');
  }

  // 无限额度的key不扣费
  if (key.isUnlimited) {
    return key;
  }

  key.balance = Math.max(0, key.balance - amount);
  key.totalSpent = (key.totalSpent || 0) + amount;

  await saveKeys(keys);
  return key;
}

// 充值（增加余额）
export async function addBalance(keyToUpdate, amount) {
  const keys = await loadKeys();
  const key = keys.find(k => k.key === keyToUpdate);

  if (!key) {
    throw new Error('密钥不存在');
  }

  key.balance = Math.min(key.maxBalance, key.balance + amount);
  await saveKeys(keys);
  logger.info(`密钥 ${keyToUpdate.substring(0, 10)}... 已充值 $${amount}`);
  return key;
}

// 更新密钥余额上限
export async function updateKeyBalance(keyToUpdate, maxBalance) {
  const keys = await loadKeys();
  const key = keys.find(k => k.key === keyToUpdate);

  if (!key) {
    throw new Error('密钥不存在');
  }

  const oldMaxBalance = key.maxBalance;
  key.maxBalance = maxBalance;
  key.isUnlimited = maxBalance === null || maxBalance === -1;

  // 如果新上限更高，自动补充余额
  if (!key.isUnlimited && maxBalance > oldMaxBalance) {
    key.balance = Math.min(maxBalance, key.balance + (maxBalance - oldMaxBalance));
  }

  // 如果新上限更低，限制当前余额
  if (!key.isUnlimited && maxBalance < key.balance) {
    key.balance = maxBalance;
  }

  await saveKeys(keys);
  logger.info(`密钥 ${keyToUpdate.substring(0, 10)}... 额度已更新: ${key.isUnlimited ? '无限' : '$' + maxBalance}`);
  return key;
}
