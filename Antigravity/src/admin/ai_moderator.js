/**
 * AI 自动管理系统
 * 使用AI自动分析共享中心玩家数据，检测异常行为并自动封禁
 */

import fs from 'fs/promises';
import path from 'path';
import log from '../utils/logger.js';
import * as shareManager from './share_manager.js';
import { loadUsers } from './user_manager.js';

const AI_CONFIG_FILE = path.join(process.cwd(), 'data', 'ai_config.json');
const AI_LOGS_FILE = path.join(process.cwd(), 'data', 'ai_moderation_logs.json');

// 默认AI配置
const defaultConfig = {
  enabled: false,
  apiKey: '',
  apiEndpoint: '',
  model: 'gemini-2.0-flash-exp',
  checkIntervalHours: 1,
  autoModerateThreshold: 0.8, // AI判断置信度阈值（0-1）
  systemPrompt: `你是一个共享资源滥用检测AI。分析用户行为数据，判断是否存在滥用行为。

# 分析规则（严格执行）
1. 使用频率：平均每天超过50次为异常
2. 使用模式：短时间内大量请求（如1小时内超过30次）
3. 时间分布：24小时持续高频使用，无正常休息时间
4. 突增行为：使用量突然大幅增加（超过历史平均3倍）

# 输出要求（必须严格遵守）
只返回JSON格式，无其他文字。格式：
{"userId":"用户ID","shouldBan":true/false,"confidence":0-1,"reason":"简短原因(15字内)","evidence":"关键数据"}

# 令牌节省规则
- 只输出JSON，无解释
- reason必须15字内
- evidence仅列关键数字
- 不输出分析过程`
};

// 加载AI配置
export async function loadAIConfig() {
  try {
    const data = await fs.readFile(AI_CONFIG_FILE, 'utf-8');
    return { ...defaultConfig, ...JSON.parse(data) };
  } catch (error) {
    if (error.code === 'ENOENT') {
      await saveAIConfig(defaultConfig);
      return defaultConfig;
    }
    log.error('加载AI配置失败:', error);
    return defaultConfig;
  }
}

// 保存AI配置
export async function saveAIConfig(config) {
  try {
    const dir = path.dirname(AI_CONFIG_FILE);
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.writeFile(AI_CONFIG_FILE, JSON.stringify(config, null, 2));
    log.info('AI配置已保存');
  } catch (error) {
    log.error('保存AI配置失败:', error);
    throw error;
  }
}

// 加载AI审核日志
async function loadAILogs() {
  try {
    const data = await fs.readFile(AI_LOGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    return [];
  }
}

// 保存AI审核日志
async function saveAILogs(logs) {
  try {
    const dir = path.dirname(AI_LOGS_FILE);
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
    // 只保留最近1000条日志
    const recentLogs = logs.slice(-1000);
    await fs.writeFile(AI_LOGS_FILE, JSON.stringify(recentLogs, null, 2));
  } catch (error) {
    log.error('保存AI日志失败:', error);
  }
}

// 添加AI日志
async function addAILog(entry) {
  const logs = await loadAILogs();
  logs.push({
    ...entry,
    timestamp: Date.now(),
    date: new Date().toISOString()
  });
  await saveAILogs(logs);
}

// 获取所有共享用户的数据
async function getAllShareUserData() {
  try {
    const users = await loadUsers();
    const shareData = await shareManager.loadShareData();

    const userData = [];

    for (const user of users) {
      const userId = user.id;

      // 获取用户使用历史
      const history = shareData.usageHistory[userId];
      if (!history || !history.dailyUsage) continue;

      // 计算统计数据
      const dailyUsages = Object.values(history.dailyUsage);
      const dates = Object.keys(history.dailyUsage);

      if (dailyUsages.length === 0) continue;

      const totalUsage = dailyUsages.reduce((sum, v) => sum + v, 0);
      const avgUsage = Math.round(totalUsage / dailyUsages.length);
      const maxUsage = Math.max(...dailyUsages);
      const minUsage = Math.min(...dailyUsages);

      // 计算最近24小时的使用量
      const today = new Date().toDateString();
      const todayUsage = history.dailyUsage[today] || 0;

      // 检查是否已被封禁
      const banStatus = await shareManager.isUserBanned(userId);

      userData.push({
        userId,
        username: user.username,
        email: user.email || 'N/A',
        stats: {
          avgDailyUsage: avgUsage,
          totalDays: dates.length,
          totalUsage,
          maxDailyUsage: maxUsage,
          minDailyUsage: minUsage,
          todayUsage,
          dailyUsagePattern: history.dailyUsage
        },
        currentlyBanned: banStatus.banned,
        banInfo: banStatus.banned ? {
          banCount: banStatus.banCount,
          reason: banStatus.reason,
          remainingTime: banStatus.remainingTime
        } : null
      });
    }

    return userData;
  } catch (error) {
    log.error('获取共享用户数据失败:', error);
    return [];
  }
}

// 调用AI分析单个用户
async function analyzeUserWithAI(userData, config) {
  try {
    const prompt = `分析以下用户数据：
用户: ${userData.username} (${userData.userId})
平均日使用: ${userData.stats.avgDailyUsage}次
最大日使用: ${userData.stats.maxDailyUsage}次
今日使用: ${userData.stats.todayUsage}次
使用天数: ${userData.stats.totalDays}天
总使用: ${userData.stats.totalUsage}次
当前封禁: ${userData.currentlyBanned}`;

    const response = await fetch(config.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: config.systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 150
      })
    });

    if (!response.ok) {
      throw new Error(`AI API响应错误: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // 尝试解析JSON响应
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI响应格式错误');
    }

    const result = JSON.parse(jsonMatch[0]);

    return {
      success: true,
      analysis: result
    };
  } catch (error) {
    log.error(`AI分析用户 ${userData.userId} 失败:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// 执行AI自动审核
export async function runAIModeration(manualTrigger = false) {
  const config = await loadAIConfig();

  if (!config.enabled && !manualTrigger) {
    log.info('AI自动审核未启用');
    return { success: false, message: 'AI自动审核未启用' };
  }

  if (!config.apiKey || !config.apiEndpoint) {
    log.error('AI配置不完整：缺少API密钥或端点');
    return { success: false, message: 'AI配置不完整' };
  }

  log.info('开始执行AI自动审核...');

  const startTime = Date.now();
  const allUserData = await getAllShareUserData();

  if (allUserData.length === 0) {
    log.info('没有需要审核的用户数据');
    return { success: true, message: '没有需要审核的用户', checkedUsers: 0 };
  }

  const results = {
    totalChecked: allUserData.length,
    bannedCount: 0,
    flaggedCount: 0,
    normalCount: 0,
    errorCount: 0,
    details: []
  };

  // 逐个分析用户
  for (const userData of allUserData) {
    // 跳过已被封禁的用户
    if (userData.currentlyBanned) {
      results.details.push({
        userId: userData.userId,
        username: userData.username,
        status: 'already_banned',
        skipped: true
      });
      continue;
    }

    const aiResult = await analyzeUserWithAI(userData, config);

    if (!aiResult.success) {
      results.errorCount++;
      results.details.push({
        userId: userData.userId,
        username: userData.username,
        status: 'error',
        error: aiResult.error
      });

      await addAILog({
        userId: userData.userId,
        username: userData.username,
        action: 'analysis_failed',
        error: aiResult.error
      });

      continue;
    }

    const analysis = aiResult.analysis;

    // 判断是否需要封禁
    if (analysis.shouldBan && analysis.confidence >= config.autoModerateThreshold) {
      try {
        const banResult = await shareManager.banUserFromSharing(
          userData.userId,
          `AI自动检测: ${analysis.reason}`
        );

        results.bannedCount++;
        results.details.push({
          userId: userData.userId,
          username: userData.username,
          status: 'banned',
          confidence: analysis.confidence,
          reason: analysis.reason,
          evidence: analysis.evidence,
          banInfo: banResult
        });

        await addAILog({
          userId: userData.userId,
          username: userData.username,
          action: 'auto_banned',
          confidence: analysis.confidence,
          reason: analysis.reason,
          evidence: analysis.evidence,
          banCount: banResult.banCount,
          banDays: banResult.durationDays
        });

        log.warn(`AI自动封禁用户 ${userData.username}: ${analysis.reason} (置信度: ${analysis.confidence})`);
      } catch (error) {
        log.error(`封禁用户 ${userData.userId} 失败:`, error);
        results.errorCount++;
      }
    } else if (analysis.shouldBan) {
      // 置信度不足，只标记
      results.flaggedCount++;
      results.details.push({
        userId: userData.userId,
        username: userData.username,
        status: 'flagged',
        confidence: analysis.confidence,
        reason: analysis.reason,
        evidence: analysis.evidence,
        note: '置信度不足，未自动封禁'
      });

      await addAILog({
        userId: userData.userId,
        username: userData.username,
        action: 'flagged',
        confidence: analysis.confidence,
        reason: analysis.reason,
        evidence: analysis.evidence
      });

      log.info(`用户 ${userData.username} 被标记为可疑: ${analysis.reason} (置信度: ${analysis.confidence})`);
    } else {
      results.normalCount++;
      results.details.push({
        userId: userData.userId,
        username: userData.username,
        status: 'normal',
        confidence: analysis.confidence
      });
    }

    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const duration = Date.now() - startTime;

  log.info(`AI审核完成: 检查${results.totalChecked}个用户, 封禁${results.bannedCount}个, 标记${results.flaggedCount}个, 正常${results.normalCount}个, 耗时${Math.round(duration/1000)}秒`);

  await addAILog({
    action: 'moderation_completed',
    summary: {
      totalChecked: results.totalChecked,
      bannedCount: results.bannedCount,
      flaggedCount: results.flaggedCount,
      normalCount: results.normalCount,
      errorCount: results.errorCount,
      durationMs: duration
    }
  });

  return {
    success: true,
    ...results,
    duration
  };
}

// 获取AI审核日志
export async function getAIModerationLogs(limit = 100) {
  const logs = await loadAILogs();
  return logs.slice(-limit).reverse();
}

// 获取AI统计信息
export async function getAIStatistics() {
  const logs = await loadAILogs();
  const config = await loadAIConfig();

  // 统计最近30天的数据
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentLogs = logs.filter(log => log.timestamp > thirtyDaysAgo);

  const stats = {
    totalRuns: 0,
    totalBanned: 0,
    totalFlagged: 0,
    totalChecked: 0,
    avgDuration: 0,
    lastRun: null,
    config: {
      enabled: config.enabled,
      model: config.model,
      checkIntervalHours: config.checkIntervalHours,
      threshold: config.autoModerateThreshold
    }
  };

  for (const log of recentLogs) {
    if (log.action === 'moderation_completed') {
      stats.totalRuns++;
      stats.totalChecked += log.summary.totalChecked || 0;
      stats.totalBanned += log.summary.bannedCount || 0;
      stats.totalFlagged += log.summary.flaggedCount || 0;
      stats.avgDuration += log.summary.durationMs || 0;
      if (!stats.lastRun || log.timestamp > stats.lastRun.timestamp) {
        stats.lastRun = {
          timestamp: log.timestamp,
          date: log.date,
          summary: log.summary
        };
      }
    }
  }

  if (stats.totalRuns > 0) {
    stats.avgDuration = Math.round(stats.avgDuration / stats.totalRuns);
  }

  return stats;
}

// 定时任务调度器
let schedulerInterval = null;

export function startAIScheduler() {
  if (schedulerInterval) {
    log.warn('AI调度器已在运行');
    return;
  }

  loadAIConfig().then(config => {
    if (!config.enabled) {
      log.info('AI自动审核未启用，调度器未启动');
      return;
    }

    const intervalMs = config.checkIntervalHours * 60 * 60 * 1000;

    log.info(`AI调度器已启动，每${config.checkIntervalHours}小时执行一次审核`);

    // 立即执行一次
    runAIModeration().catch(err => log.error('AI审核失败:', err));

    // 设置定时执行
    schedulerInterval = setInterval(() => {
      runAIModeration().catch(err => log.error('AI审核失败:', err));
    }, intervalMs);
  });
}

export function stopAIScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    log.info('AI调度器已停止');
  }
}

// 重启调度器（配置更新后）
export async function restartAIScheduler() {
  stopAIScheduler();
  startAIScheduler();
}
