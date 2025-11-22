import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import { cleanupInactiveUsers } from './security_manager.js';
import * as shareManager from './share_manager.js';

const USERS_FILE = path.join(process.cwd(), 'data', 'users.json');

// 读取所有用户
export async function loadUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// 保存用户
async function saveUsers(users) {
  const dir = path.dirname(USERS_FILE);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

// 生成用户ID
function generateUserId() {
  return 'user_' + crypto.randomBytes(8).toString('hex');
}

// 生成API密钥
function generateApiKey() {
  return 'sk-user-' + crypto.randomBytes(16).toString('hex');
}

// 密码哈希
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

// 验证密码
function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':');
  const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
}

// 生成用户会话Token
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 用户注册
export async function registerUser(username, password, email) {
  const users = await loadUsers();

  // 验证用户名格式
  if (!username || username.length < 3 || username.length > 20) {
    throw new Error('用户名长度必须在3-20个字符之间');
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    throw new Error('用户名只能包含字母、数字和下划线');
  }

  // 验证密码强度
  if (!password || password.length < 6) {
    throw new Error('密码长度至少6个字符');
  }

  // 验证邮箱格式
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('邮箱格式不正确');
  }

  // 检查用户名是否已存在
  const existingUser = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (existingUser) {
    throw new Error('用户名已被使用');
  }

  // 检查邮箱是否已存在
  if (email) {
    const existingEmail = users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
    if (existingEmail) {
      throw new Error('邮箱已被注册');
    }
  }

  // 创建新用户
  const newUser = {
    id: generateUserId(),
    username,
    password: hashPassword(password),
    email: email || null,
    apiKeys: [],
    systemPrompt: null,
    created: Date.now(),
    lastLogin: null,
    enabled: true
  };

  users.push(newUser);
  await saveUsers(users);

  logger.info(`新用户注册: ${username}`);

  return {
    id: newUser.id,
    username: newUser.username,
    email: newUser.email,
    created: newUser.created
  };
}

// 用户登录
export async function loginUser(username, password) {
  const users = await loadUsers();

  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    throw new Error('用户名或密码错误');
  }

  if (!user.enabled) {
    throw new Error('账号已被禁用');
  }

  if (!verifyPassword(password, user.password)) {
    throw new Error('用户名或密码错误');
  }

  // 更新最后登录时间
  user.lastLogin = Date.now();
  await saveUsers(users);

  // 生成会话Token
  const sessionToken = generateSessionToken();

  logger.info(`用户登录: ${username}`);

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    token: sessionToken
  };
}

// 获取用户信息
export async function getUserById(userId) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    apiKeys: user.apiKeys,
    systemPrompt: user.systemPrompt || null,
    created: user.created,
    lastLogin: user.lastLogin,
    enabled: user.enabled
  };
}

// 获取用户通过用户名
export async function getUserByUsername(username) {
  const users = await loadUsers();
  return users.find(u => u.username.toLowerCase() === username.toLowerCase());
}

// 生成用户API密钥
export async function generateUserApiKey(userId, keyName) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);

  if (!user) {
    throw new Error('用户不存在');
  }

  if (!user.enabled) {
    throw new Error('账号已被禁用');
  }

  // 限制每个用户最多5个密钥
  if (user.apiKeys.length >= 5) {
    throw new Error('每个用户最多创建5个API密钥');
  }

  const newKey = {
    id: crypto.randomBytes(8).toString('hex'),
    key: generateApiKey(),
    name: keyName || '未命名密钥',
    created: Date.now(),
    lastUsed: null,
    requests: 0
  };

  user.apiKeys.push(newKey);
  await saveUsers(users);

  logger.info(`用户 ${user.username} 创建了新密钥: ${keyName}`);

  return newKey;
}

// 删除用户API密钥
export async function deleteUserApiKey(userId, keyId) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);

  if (!user) {
    throw new Error('用户不存在');
  }

  const keyIndex = user.apiKeys.findIndex(k => k.id === keyId);
  if (keyIndex === -1) {
    throw new Error('密钥不存在');
  }

  user.apiKeys.splice(keyIndex, 1);
  await saveUsers(users);

  logger.info(`用户 ${user.username} 删除了密钥: ${keyId}`);

  return true;
}

// 获取用户所有API密钥
export async function getUserApiKeys(userId) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);

  if (!user) {
    throw new Error('用户不存在');
  }

  return user.apiKeys.map(key => ({
    id: key.id,
    key: key.key,
    name: key.name,
    created: key.created,
    lastUsed: key.lastUsed,
    requests: key.requests
  }));
}

// 验证用户API密钥
export async function validateUserApiKey(apiKey) {
  const users = await loadUsers();

  for (const user of users) {
    if (!user.enabled) continue;

    const key = user.apiKeys.find(k => k.key === apiKey);
    if (key) {
      // 更新使用统计
      key.lastUsed = Date.now();
      key.requests = (key.requests || 0) + 1;
      await saveUsers(users);

      return {
        valid: true,
        userId: user.id,
        username: user.username,
        keyId: key.id
      };
    }
  }

  return { valid: false };
}

// 更新用户信息
export async function updateUser(userId, updates) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);

  if (!user) {
    throw new Error('用户不存在');
  }

  // 更新允许的字段
  if (updates.email !== undefined) {
    if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
      throw new Error('邮箱格式不正确');
    }
    // 检查邮箱是否已被其他用户使用
    if (updates.email) {
      const existingEmail = users.find(u => u.id !== userId && u.email && u.email.toLowerCase() === updates.email.toLowerCase());
      if (existingEmail) {
        throw new Error('邮箱已被其他用户使用');
      }
    }
    user.email = updates.email || null;
  }

  if (updates.password) {
    if (updates.password.length < 6) {
      throw new Error('密码长度至少6个字符');
    }
    user.password = hashPassword(updates.password);
  }

  if (updates.systemPrompt !== undefined) {
    user.systemPrompt = updates.systemPrompt || null;
  }

  await saveUsers(users);

  logger.info(`用户 ${user.username} 更新了个人信息`);

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    systemPrompt: user.systemPrompt
  };
}

// 删除用户
export async function deleteUser(userId) {
  const users = await loadUsers();
  const index = users.findIndex(u => u.id === userId);

  if (index === -1) {
    throw new Error('用户不存在');
  }

  const username = users[index].username;
  users.splice(index, 1);
  await saveUsers(users);

  logger.info(`用户已删除: ${username}`);

  return true;
}

// 获取用户统计
export async function getUserStats() {
  const users = await loadUsers();

  return {
    total: users.length,
    enabled: users.filter(u => u.enabled).length,
    disabled: users.filter(u => !u.enabled).length,
    totalKeys: users.reduce((sum, u) => sum + u.apiKeys.length, 0)
  };
}

// 获取所有用户（管理员用）
export async function getAllUsers() {
  const users = await loadUsers();

  return users.map(user => ({
    id: user.id,
    username: user.username,
    email: user.email,
    apiKeysCount: user.apiKeys.length,
    created: user.created,
    lastLogin: user.lastLogin,
    enabled: user.enabled
  }));
}

// 启用/禁用用户（管理员用）
export async function toggleUserStatus(userId, enabled) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);

  if (!user) {
    throw new Error('用户不存在');
  }

  user.enabled = enabled;
  await saveUsers(users);

  logger.info(`用户 ${user.username} 已${enabled ? '启用' : '禁用'}`);

  return true;
}

// Google OAuth 登录/注册
export async function loginOrRegisterWithGoogle(googleUser) {
  const { email, name } = googleUser;

  if (!email) {
    throw new Error('无法获取 Google 账号邮箱');
  }

  const users = await loadUsers();

  // 查找是否存在该邮箱的用户
  let user = users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());

  if (user) {
    // 已存在用户，检查是否启用
    if (!user.enabled) {
      throw new Error('账号已被禁用');
    }

    // 更新最后登录时间
    user.lastLogin = Date.now();
    await saveUsers(users);

    logger.info(`用户通过 Google 登录: ${user.username}`);

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      isNewUser: false
    };
  } else {
    // 创建新用户
    // 使用邮箱前缀作为用户名，确保唯一性
    let baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');
    let username = baseUsername;
    let counter = 1;

    // 确保用户名唯一
    while (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
      username = `${baseUsername}${counter}`;
      counter++;
    }

    // 生成随机密码（用户可以之后在设置中修改）
    const randomPassword = crypto.randomBytes(16).toString('hex');

    const newUser = {
      id: generateUserId(),
      username,
      password: hashPassword(randomPassword),
      email: email,
      googleId: googleUser.id,
      apiKeys: [],
      created: Date.now(),
      lastLogin: Date.now(),
      enabled: true
    };

    users.push(newUser);
    await saveUsers(users);

    logger.info(`新用户通过 Google 注册: ${username} (${email})`);

    return {
      id: newUser.id,
      username: newUser.username,
      email: newUser.email,
      isNewUser: true
    };
  }
}

// 获取用户的 Google Tokens
export async function getUserTokens(userId) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);

  if (!user) {
    throw new Error('用户不存在');
  }

  return user.googleTokens || [];
}

// 添加用户 Google Token
export async function addUserToken(userId, tokenData) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);

  if (!user) {
    throw new Error('用户不存在');
  }

  if (!user.enabled) {
    throw new Error('账号已被禁用');
  }

  // 初始化 googleTokens 数组
  if (!user.googleTokens) {
    user.googleTokens = [];
  }

  // 限制每个用户最多添加10个 Token
  if (user.googleTokens.length >= 10) {
    throw new Error('每个用户最多添加10个 Token');
  }

  const newToken = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    expires_in: tokenData.expires_in || 3600,
    timestamp: Date.now(),
    email: tokenData.email || null,
    enable: true,
    // 共享功能
    isShared: false,           // 是否共享
    dailyLimit: 100,           // 每日最大使用次数
    usageToday: 0,             // 今日已使用次数
    lastResetDate: new Date().toDateString()  // 上次重置日期
  };

  user.googleTokens.push(newToken);
  await saveUsers(users);

  logger.info(`用户 ${user.username} 添加了新 Token`);

  return { success: true, index: user.googleTokens.length - 1 };
}

// 删除用户 Google Token
export async function deleteUserToken(userId, tokenIndex) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);

  if (!user) {
    throw new Error('用户不存在');
  }

  if (!user.googleTokens || tokenIndex < 0 || tokenIndex >= user.googleTokens.length) {
    throw new Error('Token 不存在');
  }

  user.googleTokens.splice(tokenIndex, 1);
  await saveUsers(users);

  logger.info(`用户 ${user.username} 删除了 Token #${tokenIndex}`);

  return { success: true };
}

// 获取用户的随机可用 Token（用于 API 调用）
export async function getUserAvailableToken(userId) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);

  if (!user || !user.googleTokens || user.googleTokens.length === 0) {
    return null;
  }

  // 筛选启用的 Token
  const enabledTokens = user.googleTokens.filter(t => t.enable !== false);

  if (enabledTokens.length === 0) {
    return null;
  }

  // 随机返回一个
  const randomIndex = Math.floor(Math.random() * enabledTokens.length);
  return enabledTokens[randomIndex];
}

// 定期清理未登录账号任务
let cleanupTimer = null;

export function startInactiveUsersCleanup() {
  // 每天清理一次（24小时）
  const cleanupInterval = 24 * 60 * 60 * 1000;

  async function performCleanup() {
    try {
      logger.info('开始清理长时间未登录账号...');
      const users = await loadUsers();
      const result = await cleanupInactiveUsers(users);

      if (result.deletedCount > 0) {
        await saveUsers(result.users);
        logger.info(`已清理 ${result.deletedCount} 个长时间未登录账号`);
      } else {
        logger.info('没有需要清理的账号');
      }
    } catch (error) {
      logger.error('清理账号失败:', error.message);
    }
  }

  // 立即执行一次
  performCleanup();

  // 设置定时器
  cleanupTimer = setInterval(performCleanup, cleanupInterval);
  logger.info('账号自动清理任务已启动（每24小时执行一次）');
}

export function stopInactiveUsersCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    logger.info('账号自动清理任务已停止');
  }
}

// ========== Token 共享功能 ==========

// 更新 Token 共享设置
export async function updateTokenSharing(userId, tokenIndex, sharingSettings) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);

  if (!user) {
    throw new Error('用户不存在');
  }

  if (!user.googleTokens || tokenIndex < 0 || tokenIndex >= user.googleTokens.length) {
    throw new Error('Token 不存在');
  }

  const token = user.googleTokens[tokenIndex];

  // 更新共享设置
  if (sharingSettings.isShared !== undefined) {
    token.isShared = sharingSettings.isShared;
  }

  if (sharingSettings.dailyLimit !== undefined) {
    token.dailyLimit = Math.max(1, Math.min(10000, parseInt(sharingSettings.dailyLimit)));
  }

  await saveUsers(users);

  logger.info(`用户 ${user.username} 更新了 Token #${tokenIndex} 的共享设置: ${token.isShared ? '已共享' : '未共享'}, 限制: ${token.dailyLimit}/天`);

  return { success: true, token };
}

// 获取所有共享的 Token（来自所有用户）
export async function getAllSharedTokens() {
  const users = await loadUsers();
  const sharedTokens = [];

  for (const user of users) {
    if (!user.enabled || !user.googleTokens) continue;

    user.googleTokens.forEach((token, index) => {
      if (token.isShared && token.enable) {
        // 检查是否需要重置每日使用次数
        const today = new Date().toDateString();
        if (token.lastResetDate !== today) {
          token.usageToday = 0;
          token.lastResetDate = today;
        }

        sharedTokens.push({
          userId: user.id,
          username: user.username,
          tokenIndex: index,
          email: token.email,
          dailyLimit: token.dailyLimit,
          usageToday: token.usageToday,
          remainingToday: token.dailyLimit - token.usageToday,
          timestamp: token.timestamp,
          token: token
        });
      }
    });
  }

  return sharedTokens;
}

// 获取随机可用的共享 Token（带封禁和黑名单检查）
export async function getRandomSharedToken(callerId = null) {
  // 检查调用者是否被封禁
  if (callerId) {
    const banStatus = await shareManager.isUserBanned(callerId);
    if (banStatus.banned) {
      logger.info(`用户 ${callerId} 被封禁使用共享，剩余时间: ${Math.round(banStatus.remainingTime / 3600000)}小时`);
      return {
        error: 'banned',
        banned: true,
        banUntil: banStatus.banUntil,
        remainingTime: banStatus.remainingTime,
        reason: banStatus.reason
      };
    }
  }

  const users = await loadUsers();
  const today = new Date().toDateString();
  const availableTokens = [];

  for (const user of users) {
    if (!user.enabled || !user.googleTokens) continue;

    for (let index = 0; index < user.googleTokens.length; index++) {
      const token = user.googleTokens[index];
      if (!token.isShared || !token.enable) continue;

      // 检查调用者是否在该 Token 的黑名单中
      if (callerId) {
        const isBlacklisted = await shareManager.isUserBlacklisted(user.id, index, callerId);
        if (isBlacklisted) {
          continue; // 跳过这个 Token
        }
      }

      // 重置每日使用次数
      if (token.lastResetDate !== today) {
        token.usageToday = 0;
        token.lastResetDate = today;
      }

      // 检查是否还有剩余使用次数
      if (token.usageToday < token.dailyLimit) {
        availableTokens.push({
          user,
          tokenIndex: index,
          token
        });
      }
    }
  }

  if (availableTokens.length === 0) {
    return null;
  }

  // 随机选择一个
  const randomIndex = Math.floor(Math.random() * availableTokens.length);
  const selected = availableTokens[randomIndex];

  // 增加使用次数
  selected.token.usageToday++;
  await saveUsers(users);

  // 记录共享使用并检查滥用
  if (callerId) {
    await shareManager.recordShareUsage(callerId);
    // 异步检查是否需要封禁（不阻塞当前请求）
    shareManager.checkAndBanAbuser(callerId).catch(err =>
      logger.error('检查滥用失败:', err)
    );
  }

  logger.info(`共享 Token 被使用: ${selected.user.username} 的 Token #${selected.tokenIndex} (今日: ${selected.token.usageToday}/${selected.token.dailyLimit})`);

  return {
    access_token: selected.token.access_token,
    refresh_token: selected.token.refresh_token,
    expires_in: selected.token.expires_in,
    email: selected.token.email,
    owner: selected.user.username,
    ownerId: selected.user.id,
    usageToday: selected.token.usageToday,
    dailyLimit: selected.token.dailyLimit
  };
}

// 获取共享统计信息
export async function getSharedTokenStats() {
  const sharedTokens = await getAllSharedTokens();

  const totalShared = sharedTokens.length;
  const totalAvailable = sharedTokens.filter(t => t.remainingToday > 0).length;
  const totalUsageToday = sharedTokens.reduce((sum, t) => sum + t.usageToday, 0);
  const totalLimitToday = sharedTokens.reduce((sum, t) => sum + t.dailyLimit, 0);

  return {
    totalShared,
    totalAvailable,
    totalUsageToday,
    totalLimitToday,
    remainingToday: totalLimitToday - totalUsageToday,
    tokens: sharedTokens.map(t => ({
      username: t.username,
      email: t.email,
      usageToday: t.usageToday,
      dailyLimit: t.dailyLimit,
      remainingToday: t.remainingToday
    }))
  };
}

// 获取用户或共享 Token（用于 API 调用）
export async function getUserOrSharedToken(userId) {
  // 首先尝试使用用户自己的 Token
  const userToken = await getUserAvailableToken(userId);
  if (userToken) {
    logger.info(`使用用户自己的 Token: userId=${userId}`);
    return userToken;
  }

  // 如果用户没有可用 Token，使用共享池
  const sharedToken = await getRandomSharedToken();
  if (sharedToken) {
    logger.info(`用户 ${userId} 使用共享 Token: owner=${sharedToken.owner}`);
    return sharedToken;
  }

  // 没有任何可用 Token
  return null;
}
