/**
 * 共享系统管理器
 * 处理共享滥用检测、封禁、投票等功能
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import logger from '../utils/logger.js';

const SHARE_DATA_FILE = path.join(process.cwd(), 'data', 'share_data.json');

// 默认数据结构
const defaultData = {
  // 用户共享封禁记录
  userBans: {},
  // 用户使用记录（用于计算平均用量）
  usageHistory: {},
  // 投票记录
  votes: [],
  // Token 黑名单（共享者设置的禁止调用列表）
  tokenBlacklists: {}
};

// 加载共享数据
export async function loadShareData() {
  try {
    if (fs.existsSync(SHARE_DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(SHARE_DATA_FILE, 'utf-8'));
      return { ...defaultData, ...data };
    }
  } catch (error) {
    logger.error('加载共享数据失败:', error);
  }
  return { ...defaultData };
}

// 保存共享数据
export async function saveShareData(data) {
  try {
    const dir = path.dirname(SHARE_DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SHARE_DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    logger.error('保存共享数据失败:', error);
  }
}

// ==================== 用户封禁系统 ====================

// 封禁时长配置（毫秒）
const BAN_DURATIONS = [
  1 * 24 * 60 * 60 * 1000,   // 第1次：1天
  3 * 24 * 60 * 60 * 1000,   // 第2次：3天
  7 * 24 * 60 * 60 * 1000,   // 第3次：7天
  14 * 24 * 60 * 60 * 1000,  // 第4次：14天
  30 * 24 * 60 * 60 * 1000,  // 第5次：30天
  90 * 24 * 60 * 60 * 1000,  // 第6次及以后：90天
];

// 平均用量阈值（超过此值触发封禁）
const USAGE_THRESHOLD = 50; // 每天平均使用超过50次

// 检查用户是否被封禁使用共享
export async function isUserBanned(userId) {
  const data = await loadShareData();
  const ban = data.userBans[userId];

  if (!ban || !ban.banned) return { banned: false };

  // 检查封禁是否已过期
  if (ban.banUntil && Date.now() > ban.banUntil) {
    // 解除封禁
    ban.banned = false;
    await saveShareData(data);
    return { banned: false };
  }

  return {
    banned: true,
    banUntil: ban.banUntil,
    banCount: ban.banCount,
    reason: ban.reason,
    remainingTime: ban.banUntil - Date.now()
  };
}

// 封禁用户使用共享
export async function banUserFromSharing(userId, reason = '滥用共享资源') {
  const data = await loadShareData();

  if (!data.userBans[userId]) {
    data.userBans[userId] = { banCount: 0 };
  }

  const ban = data.userBans[userId];
  ban.banCount++;
  ban.banned = true;
  ban.reason = reason;
  ban.lastBanTime = Date.now();

  // 计算封禁时长
  const durationIndex = Math.min(ban.banCount - 1, BAN_DURATIONS.length - 1);
  const duration = BAN_DURATIONS[durationIndex];
  ban.banUntil = Date.now() + duration;

  await saveShareData(data);

  const durationDays = Math.round(duration / (24 * 60 * 60 * 1000));
  logger.info(`用户 ${userId} 被封禁使用共享 ${durationDays} 天，原因: ${reason}`);

  return {
    banCount: ban.banCount,
    banUntil: ban.banUntil,
    durationDays
  };
}

// 解除封禁
export async function unbanUser(userId) {
  const data = await loadShareData();
  if (data.userBans[userId]) {
    data.userBans[userId].banned = false;
    await saveShareData(data);
    logger.info(`用户 ${userId} 的共享封禁已解除`);
  }
  return true;
}

// 记录用户使用共享
export async function recordShareUsage(userId) {
  const data = await loadShareData();
  const today = new Date().toDateString();

  if (!data.usageHistory[userId]) {
    data.usageHistory[userId] = { dailyUsage: {}, totalDays: 0 };
  }

  const history = data.usageHistory[userId];
  if (!history.dailyUsage[today]) {
    history.dailyUsage[today] = 0;
    history.totalDays++;
  }
  history.dailyUsage[today]++;

  // 只保留最近30天的记录
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const date in history.dailyUsage) {
    if (new Date(date).getTime() < thirtyDaysAgo) {
      delete history.dailyUsage[date];
    }
  }

  await saveShareData(data);

  return history.dailyUsage[today];
}

// 获取用户平均使用量
export async function getUserAverageUsage(userId) {
  const data = await loadShareData();
  const history = data.usageHistory[userId];

  if (!history || !history.dailyUsage) return 0;

  const days = Object.keys(history.dailyUsage);
  if (days.length === 0) return 0;

  const total = Object.values(history.dailyUsage).reduce((sum, v) => sum + v, 0);
  return Math.round(total / days.length);
}

// 检查并执行滥用封禁
export async function checkAndBanAbuser(userId) {
  const avgUsage = await getUserAverageUsage(userId);

  if (avgUsage > USAGE_THRESHOLD) {
    const result = await banUserFromSharing(userId, `平均用量过高 (${avgUsage}次/天)`);
    return {
      banned: true,
      avgUsage,
      ...result
    };
  }

  return { banned: false, avgUsage };
}

// ==================== Token 黑名单系统 ====================

// 将用户添加到 Token 的黑名单
export async function addToTokenBlacklist(ownerId, tokenIndex, targetUserId) {
  const data = await loadShareData();
  const key = `${ownerId}_${tokenIndex}`;

  if (!data.tokenBlacklists[key]) {
    data.tokenBlacklists[key] = [];
  }

  if (!data.tokenBlacklists[key].includes(targetUserId)) {
    data.tokenBlacklists[key].push(targetUserId);
    await saveShareData(data);
    logger.info(`用户 ${targetUserId} 被添加到 ${ownerId} 的 Token #${tokenIndex} 黑名单`);
  }

  return data.tokenBlacklists[key];
}

// 从 Token 黑名单移除用户
export async function removeFromTokenBlacklist(ownerId, tokenIndex, targetUserId) {
  const data = await loadShareData();
  const key = `${ownerId}_${tokenIndex}`;

  if (data.tokenBlacklists[key]) {
    data.tokenBlacklists[key] = data.tokenBlacklists[key].filter(id => id !== targetUserId);
    await saveShareData(data);
  }

  return data.tokenBlacklists[key] || [];
}

// 检查用户是否在 Token 黑名单中
export async function isUserBlacklisted(ownerId, tokenIndex, userId) {
  const data = await loadShareData();
  const key = `${ownerId}_${tokenIndex}`;

  return data.tokenBlacklists[key]?.includes(userId) || false;
}

// 获取 Token 的黑名单
export async function getTokenBlacklist(ownerId, tokenIndex) {
  const data = await loadShareData();
  const key = `${ownerId}_${tokenIndex}`;
  return data.tokenBlacklists[key] || [];
}

// ==================== 投票封禁系统 ====================

// 创建投票
export async function createVote(targetUserId, reason, createdBy) {
  const data = await loadShareData();

  // 检查是否已有针对该用户的活跃投票
  const existingVote = data.votes.find(v =>
    v.targetUserId === targetUserId && v.status === 'active'
  );
  if (existingVote) {
    return { error: '已存在针对该用户的投票', existingVote };
  }

  const vote = {
    id: `vote_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
    targetUserId,
    reason,
    createdBy,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24小时后过期
    votes: {},       // { userId: 'ban' | 'unban' }
    comments: [],    // [{ userId, content, time }]
    status: 'active' // 'active' | 'passed' | 'rejected' | 'expired'
  };

  data.votes.push(vote);
  await saveShareData(data);

  logger.info(`用户 ${createdBy} 发起了对 ${targetUserId} 的封禁投票`);

  return { success: true, vote };
}

// 投票
export async function castVote(voteId, userId, decision) {
  const data = await loadShareData();
  const vote = data.votes.find(v => v.id === voteId);

  if (!vote) return { error: '投票不存在' };
  if (vote.status !== 'active') return { error: '投票已结束' };
  if (Date.now() > vote.expiresAt) {
    vote.status = 'expired';
    await saveShareData(data);
    return { error: '投票已过期' };
  }
  if (vote.targetUserId === userId) return { error: '不能对自己投票' };

  vote.votes[userId] = decision; // 'ban' 或 'unban'
  await saveShareData(data);

  return { success: true, vote };
}

// 添加评论
export async function addVoteComment(voteId, userId, content) {
  const data = await loadShareData();
  const vote = data.votes.find(v => v.id === voteId);

  if (!vote) return { error: '投票不存在' };

  vote.comments.push({
    userId,
    content,
    time: Date.now()
  });

  await saveShareData(data);
  return { success: true, vote };
}

// 获取投票结果并处理
export async function processVoteResult(voteId) {
  const data = await loadShareData();
  const vote = data.votes.find(v => v.id === voteId);

  if (!vote) return { error: '投票不存在' };
  if (vote.status !== 'active') return { status: vote.status };

  // 检查是否到期
  if (Date.now() < vote.expiresAt) {
    return { error: '投票尚未结束', remainingTime: vote.expiresAt - Date.now() };
  }

  // 计算投票结果
  const voteValues = Object.values(vote.votes);
  const banVotes = voteValues.filter(v => v === 'ban').length;
  const unbanVotes = voteValues.filter(v => v === 'unban').length;

  // 需要至少3票且封禁票数超过半数才通过
  if (voteValues.length >= 3 && banVotes > voteValues.length / 2) {
    vote.status = 'passed';
    // 执行封禁
    await banUserFromSharing(vote.targetUserId, `社区投票封禁 (${banVotes}/${voteValues.length})`);
  } else {
    vote.status = 'rejected';
  }

  await saveShareData(data);

  return {
    status: vote.status,
    banVotes,
    unbanVotes,
    totalVotes: voteValues.length
  };
}

// 获取所有活跃投票
export async function getActiveVotes() {
  const data = await loadShareData();
  const now = Date.now();

  // 处理过期的投票
  for (const vote of data.votes) {
    if (vote.status === 'active' && now > vote.expiresAt) {
      await processVoteResult(vote.id);
    }
  }

  return data.votes.filter(v => v.status === 'active');
}

// 获取投票详情
export async function getVoteById(voteId) {
  const data = await loadShareData();
  return data.votes.find(v => v.id === voteId);
}

// 获取用户的投票历史
export async function getUserVoteHistory(userId) {
  const data = await loadShareData();
  return data.votes.filter(v => v.targetUserId === userId);
}

// 获取所有投票（包括历史）
export async function getAllVotes() {
  const data = await loadShareData();
  return data.votes;
}

// 获取用户共享状态摘要
export async function getUserShareStatus(userId) {
  const banStatus = await isUserBanned(userId);
  const avgUsage = await getUserAverageUsage(userId);
  const data = await loadShareData();

  // 获取针对该用户的投票
  const activeVotes = data.votes.filter(v =>
    v.targetUserId === userId && v.status === 'active'
  );

  return {
    ...banStatus,
    avgUsage,
    activeVotes: activeVotes.length,
    usageHistory: data.usageHistory[userId]?.dailyUsage || {}
  };
}
