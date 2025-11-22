import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';

const PRICING_FILE = path.join(process.cwd(), 'data', 'pricing.json');

// 默认定价配置（Gemini 3 Pro 计费标准，美元/百万tokens）
const DEFAULT_PRICING = {
  'gemini-3-pro-preview': {
    input: 1.25,
    output: 5.0
  },
  'gemini-3-pro-high': {
    input: 1.25,
    output: 5.0
  },
  'gemini-2.5-pro': {
    input: 1.25,
    output: 2.50
  },
  'gemini-2.5-flash': {
    input: 0.075,
    output: 0.30
  },
  'default': {
    input: 1.25,
    output: 5.0
  }
};

// 确保数据目录存在
async function ensureDataDir() {
  const dataDir = path.dirname(PRICING_FILE);
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

// 加载定价配置
export async function loadPricing() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(PRICING_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // 文件不存在，使用默认配置并保存
      await savePricing(DEFAULT_PRICING);
      return DEFAULT_PRICING;
    }
    throw error;
  }
}

// 保存定价配置
export async function savePricing(pricing) {
  await ensureDataDir();
  await fs.writeFile(PRICING_FILE, JSON.stringify(pricing, null, 2), 'utf-8');
  logger.info('定价配置已保存');
}

// 获取特定模型的定价
export async function getModelPricing(model) {
  const pricing = await loadPricing();
  return pricing[model] || pricing['default'];
}

// 更新特定模型的定价
export async function updateModelPricing(model, inputPrice, outputPrice) {
  const pricing = await loadPricing();

  if (inputPrice < 0 || outputPrice < 0) {
    throw new Error('价格不能为负数');
  }

  pricing[model] = {
    input: parseFloat(inputPrice),
    output: parseFloat(outputPrice)
  };

  await savePricing(pricing);
  logger.info(`模型 ${model} 的定价已更新: input=$${inputPrice}/M, output=$${outputPrice}/M`);

  return pricing[model];
}

// 删除模型定价（恢复为使用默认定价）
export async function deleteModelPricing(model) {
  if (model === 'default') {
    throw new Error('不能删除默认定价');
  }

  const pricing = await loadPricing();

  if (!pricing[model]) {
    throw new Error('模型定价不存在');
  }

  delete pricing[model];
  await savePricing(pricing);
  logger.info(`模型 ${model} 的定价已删除，将使用默认定价`);

  return true;
}

// 重置所有定价为默认值
export async function resetPricing() {
  await savePricing(DEFAULT_PRICING);
  logger.info('所有定价已重置为默认值');
  return DEFAULT_PRICING;
}

// 添加新模型定价
export async function addModelPricing(model, inputPrice, outputPrice) {
  const pricing = await loadPricing();

  if (pricing[model]) {
    throw new Error('模型定价已存在，请使用更新功能');
  }

  if (inputPrice < 0 || outputPrice < 0) {
    throw new Error('价格不能为负数');
  }

  pricing[model] = {
    input: parseFloat(inputPrice),
    output: parseFloat(outputPrice)
  };

  await savePricing(pricing);
  logger.info(`新模型 ${model} 的定价已添加: input=$${inputPrice}/M, output=$${outputPrice}/M`);

  return pricing[model];
}
