import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import fs from 'fs/promises';
import path from 'path';
import { createKey, loadKeys, deleteKey, updateKeyRateLimit, getKeyStats, updateKeyBalance, addBalance, getKey } from './key_manager.js';
import { getUsageByKey, getUsageStats } from './usage_logger.js';
import { loadPricing, updateModelPricing, deleteModelPricing, resetPricing, addModelPricing } from './pricing_manager.js';
import { getRecentLogs, clearLogs, addLog } from './log_manager.js';
import { getSystemStatus, incrementRequestCount } from './monitor.js';
import { loadAccounts, deleteAccount, toggleAccount, setTokenProxy, triggerLogin, getAccountStats, addTokenFromCallback, getAccountName, importTokens } from './token_admin.js';
import { createSession, validateSession, destroySession, verifyPassword, adminAuth } from './session.js';
import { loadSettings, saveSettings } from './settings_manager.js';
import tokenManager from '../auth/token_manager.js';
import proxyManager from './proxy_manager.js';
import { getSecurityStats, unbanIP, unbanDevice, isIPBanned, isDeviceBanned } from './security_manager.js';
import { isUserBanned, banUserFromSharing, unbanUser, recordShareUsage, getUserAverageUsage, checkAndBanAbuser, addToTokenBlacklist, removeFromTokenBlacklist, isUserBlacklisted, getTokenBlacklist, createVote, castVote, addVoteComment, processVoteResult, getActiveVotes, getVoteById, getUserVoteHistory, getAllVotes, getUserShareStatus } from './share_manager.js';
import { registerUser, loginUser, getUserById, getUserByUsername, generateUserApiKey, deleteUserApiKey, getUserApiKeys, validateUserApiKey, updateUser, deleteUser, getUserStats, getAllUsers, toggleUserStatus, loginOrRegisterWithGoogle, getUserTokens, addUserToken, deleteUserToken, getUserAvailableToken } from './user_manager.js';
import { loadAIConfig, saveAIConfig, runAIModeration, getAIModerationLogs, getAIStatistics, startAIScheduler, stopAIScheduler, restartAIScheduler } from './ai_moderator.js';
import { isSystemInitialized, initializeSystem, adminLogin, changeAdminPassword, getAdminInfo, getAllAdmins, createAdmin, deleteAdmin } from './admin_manager.js';

// 配置文件上传
const upload = multer({ dest: 'uploads/' });

const router = express.Router();

// ========== 系统初始化相关（公开路由）==========

// 检查系统是否已初始化
router.get('/system/status', async (req, res) => {
  try {
    const initialized = isSystemInitialized();
    res.json({ initialized });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 初始化系统（创建第一个管理员）
router.post('/system/initialize', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const result = initializeSystem(username, password);
    await addLog('success', `系统初始化完成，管理员: ${username}`);
    res.json(result);
  } catch (error) {
    await addLog('error', `系统初始化失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// ========== 管理员登录相关 ==========

// 新的管理员登录接口（使用数据库）
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const result = adminLogin(username, password);
    await addLog('info', `管理员登录成功: ${username}`);
    res.json(result);
  } catch (error) {
    await addLog('warn', `管理员登录失败: ${error.message}`);
    res.status(401).json({ error: error.message });
  }
});

// 旧的登录接口（使用config.json）- 保留以兼容旧系统
router.post('/login', async (req, res) => {
  try {
    // 如果系统已初始化，重定向到新的登录接口
    if (isSystemInitialized()) {
      return res.status(400).json({
        error: '请使用新的登录接口 /admin/admin/login',
        redirectTo: '/admin/admin/login'
      });
    }

    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: '请输入密码' });
    }

    if (verifyPassword(password)) {
      const token = createSession();
      await addLog('info', '管理员登录成功（旧系统）');
      res.json({ success: true, token });
    } else {
      await addLog('warn', '管理员登录失败：密码错误');
      res.status(401).json({ error: '密码错误' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 登出接口
router.post('/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) {
    destroySession(token);
  }
  res.json({ success: true });
});

// 验证会话接口
router.get('/verify', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (validateSession(token)) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false });
  }
});

// ========== 用户查询API（使用API key认证，不需要管理员权限）==========

// 用户查询自己的余额和统计
router.get('/user/balance', async (req, res) => {
  try {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API Key' });
    }

    const keyInfo = await getKey(apiKey);
    if (!keyInfo) {
      return res.status(404).json({ error: 'API Key not found' });
    }

    const stats = await getUsageStats(apiKey);

    res.json({
      name: keyInfo.name,
      balance: keyInfo.balance,
      maxBalance: keyInfo.maxBalance,
      totalSpent: keyInfo.totalSpent,
      isUnlimited: keyInfo.isUnlimited,
      ...stats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 用户查询自己的使用日志
router.get('/user/usage', async (req, res) => {
  try {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API Key' });
    }

    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const result = await getUsageByKey(apiKey, limit, offset);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 用户系统 - 公开路由（不需要认证）==========

// 用户注册
router.post('/users/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    const user = await registerUser(username, password, email);
    await addLog('success', `新用户注册: ${username}`);
    res.json({ success: true, user });
  } catch (error) {
    await addLog('error', `用户注册失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 用户登录
router.post('/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await loginUser(username, password);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

// Google OAuth 登录/注册
router.post('/users/google-auth', async (req, res) => {
  try {
    const { googleUser } = req.body;
    if (!googleUser || !googleUser.email) {
      return res.status(400).json({ error: '无效的 Google 用户信息' });
    }

    const result = await loginOrRegisterWithGoogle(googleUser);
    await addLog('info', `Google 登录: ${result.username}`);
    res.json({ success: true, ...result });
  } catch (error) {
    await addLog('error', `Google 登录失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 以下所有路由需要认证
router.use(adminAuth);

// 生成新密钥
router.post('/keys/generate', async (req, res) => {
  try {
    const { name, rateLimit, maxBalance } = req.body;
    const newKey = await createKey(name, rateLimit, maxBalance);
    await addLog('success', `密钥已生成: ${name || '未命名'}, 额度: ${maxBalance === null || maxBalance === -1 ? '无限' : '$' + maxBalance}`);
    res.json({
      success: true,
      key: newKey.key,
      name: newKey.name,
      rateLimit: newKey.rateLimit,
      balance: newKey.balance,
      maxBalance: newKey.maxBalance,
      isUnlimited: newKey.isUnlimited
    });
  } catch (error) {
    await addLog('error', `生成密钥失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 获取所有密钥
router.get('/keys', async (req, res) => {
  try {
    const keys = await loadKeys();
    // 返回密钥列表（隐藏部分字符）
    const safeKeys = keys.map(k => ({
      ...k,
      key: k.key.substring(0, 10) + '...' + k.key.substring(k.key.length - 4)
    }));
    res.json(keys); // 在管理界面显示完整密钥
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除密钥
router.delete('/keys/:key', async (req, res) => {
  try {
    const { key } = req.params;
    await deleteKey(key);
    await addLog('warn', `密钥已删除: ${key.substring(0, 10)}...`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `删除密钥失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 更新密钥频率限制
router.patch('/keys/:key/ratelimit', async (req, res) => {
  try {
    const { key } = req.params;
    const { rateLimit } = req.body;
    await updateKeyRateLimit(key, rateLimit);
    await addLog('info', `密钥频率限制已更新: ${key.substring(0, 10)}...`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `更新频率限制失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 获取密钥统计
router.get('/keys/stats', async (req, res) => {
  try {
    const stats = await getKeyStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取日志
router.get('/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const logs = await getRecentLogs(limit);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 清空日志
router.delete('/logs', async (req, res) => {
  try {
    await clearLogs();
    await addLog('info', '日志已清空');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取系统状态
router.get('/status', async (req, res) => {
  try {
    const status = getSystemStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Token 管理路由

// 获取所有账号
router.get('/tokens', async (req, res) => {
  try {
    const accounts = await loadAccounts();
    // 隐藏敏感信息，只返回必要字段
    const safeAccounts = accounts.map((acc, index) => ({
      index,
      access_token: acc.access_token?.substring(0, 20) + '...',
      refresh_token: acc.refresh_token ? 'exists' : 'none',
      expires_in: acc.expires_in,
      timestamp: acc.timestamp,
      enable: acc.enable !== false,
      created: new Date(acc.timestamp).toLocaleString()
    }));
    res.json(safeAccounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除账号
router.delete('/tokens/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    await deleteAccount(index);
    await addLog('warn', `Token 账号 ${index} 已删除`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `删除 Token 失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 启用/禁用账号
router.patch('/tokens/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    const { enable } = req.body;
    await toggleAccount(index, enable);
    await addLog('info', `Token 账号 ${index} 已${enable ? '启用' : '禁用'}`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `切换 Token 状态失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 触发登录流程
router.post('/tokens/login', async (req, res) => {
  try {
    await addLog('info', '开始 Google OAuth 登录流程');
    const result = await triggerLogin();
    res.json(result);
  } catch (error) {
    await addLog('error', `登录失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 获取 Token 统计
router.get('/tokens/stats', async (req, res) => {
  try {
    const stats = await getAccountStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取 Token 使用统计（轮询信息）
router.get('/tokens/usage', async (req, res) => {
  try {
    const usageStats = tokenManager.getUsageStats();
    res.json(usageStats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 手动添加 Token（通过回调链接）
router.post('/tokens/callback', async (req, res) => {
  try {
    const { callbackUrl } = req.body;
    if (!callbackUrl) {
      return res.status(400).json({ error: '请提供回调链接' });
    }
    await addLog('info', '正在通过回调链接添加 Token...');
    const result = await addTokenFromCallback(callbackUrl);
    await addLog('success', 'Token 已通过回调链接成功添加');
    res.json(result);
  } catch (error) {
    await addLog('error', `添加 Token 失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 获取账号详细信息（包括名称）
router.post('/tokens/details', async (req, res) => {
  try {
    const { indices } = req.body;
    const accounts = await loadAccounts();
    const details = [];

    for (const index of indices) {
      if (index >= 0 && index < accounts.length) {
        const account = accounts[index];
        const accountInfo = await getAccountName(account.access_token);
        details.push({
          index,
          email: accountInfo.email,
          name: accountInfo.name,
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          expires_in: account.expires_in,
          timestamp: account.timestamp,
          enable: account.enable !== false,
          proxyId: account.proxyId || null,
          disabledUntil: account.disabledUntil || null,
          quotaExhausted: account.quotaExhausted || false,
          dailyCost: account.dailyCost || 0,
          totalCost: account.totalCost || 0
        });
      }
    }

    res.json(details);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批量导出 Token (ZIP格式)
router.post('/tokens/export', async (req, res) => {
  try {
    const { indices } = req.body;
    const accounts = await loadAccounts();
    const exportData = [];

    for (const index of indices) {
      if (index >= 0 && index < accounts.length) {
        const account = accounts[index];
        const accountInfo = await getAccountName(account.access_token);
        exportData.push({
          email: accountInfo.email,
          name: accountInfo.name,
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          expires_in: account.expires_in,
          timestamp: account.timestamp,
          created: new Date(account.timestamp).toLocaleString(),
          enable: account.enable !== false
        });
      }
    }

    await addLog('info', `批量导出了 ${exportData.length} 个 Token 账号`);

    // 创建 ZIP 文件
    const archive = archiver('zip', { zlib: { level: 9 } });
    const timestamp = new Date().toISOString().split('T')[0];

    res.attachment(`tokens_export_${timestamp}.zip`);
    res.setHeader('Content-Type', 'application/zip');

    archive.pipe(res);

    // 添加 tokens.json 文件到 ZIP
    archive.append(JSON.stringify(exportData, null, 2), { name: 'tokens.json' });

    await archive.finalize();
  } catch (error) {
    await addLog('error', `批量导出失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 批量导入 Token (ZIP格式)
router.post('/tokens/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    await addLog('info', '正在导入 Token 账号...');
    const result = await importTokens(req.file.path);
    await addLog('success', `成功导入 ${result.count} 个 Token 账号`);
    res.json(result);
  } catch (error) {
    await addLog('error', `导入失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 获取系统设置
router.get('/settings', async (req, res) => {
  try {
    const settings = await loadSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 保存系统设置
router.post('/settings', async (req, res) => {
  try {
    const result = await saveSettings(req.body);
    await addLog('success', '系统设置已更新');
    res.json(result);
  } catch (error) {
    await addLog('error', `保存设置失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 代理管理路由

// 获取所有代理
router.get('/proxies', async (req, res) => {
  try {
    const proxies = proxyManager.getAllProxies();
    res.json(proxies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 添加代理
router.post('/proxies', async (req, res) => {
  try {
    const proxy = await proxyManager.addProxy(req.body);
    await addLog('success', `代理已添加: ${proxy.name}`);
    res.json({ success: true, proxy });
  } catch (error) {
    await addLog('error', `添加代理失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 更新代理
router.patch('/proxies/:id', async (req, res) => {
  try {
    const proxy = await proxyManager.updateProxy(req.params.id, req.body);
    await addLog('info', `代理已更新: ${proxy.name}`);
    res.json({ success: true, proxy });
  } catch (error) {
    await addLog('error', `更新代理失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 删除代理
router.delete('/proxies/:id', async (req, res) => {
  try {
    const proxy = await proxyManager.deleteProxy(req.params.id);
    await addLog('warn', `代理已删除: ${proxy.name}`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `删除代理失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 测试单个代理
router.post('/proxies/:id/test', async (req, res) => {
  try {
    const proxy = proxyManager.getProxyById(req.params.id);
    if (!proxy) {
      return res.status(404).json({ error: '代理不存在' });
    }
    const result = await proxyManager.testProxy(proxy);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 测试所有代理
router.post('/proxies/test-all', async (req, res) => {
  try {
    const results = await proxyManager.testAllProxies();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 为Token设置代理
router.patch('/tokens/:index/proxy', async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    const { proxyId } = req.body;
    await setTokenProxy(index, proxyId);
    await addLog('info', `Token ${index} 的代理已设置`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `设置Token代理失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 手动解除Token禁用（恢复配额）
router.post('/tokens/:index/restore', async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    const accounts = await loadAccounts();

    if (index < 0 || index >= accounts.length) {
      return res.status(404).json({ error: 'Token 不存在' });
    }

    const account = accounts[index];

    // 移除禁用标记
    delete account.disabledUntil;
    delete account.quotaExhausted;

    // 保存到正确的文件 (accounts.json)
    const fs = await import('fs/promises');
    const accountsPath = path.join(process.cwd(), 'data', 'accounts.json');
    await fs.writeFile(accountsPath, JSON.stringify(accounts, null, 2));

    // 强制刷新 token 管理器以使更改立即生效
    tokenManager.forceReload();

    await addLog('info', `手动恢复 Token ${index} (配额限制已解除)`);
    res.json({ success: true, message: 'Token 已恢复' });
  } catch (error) {
    await addLog('error', `恢复Token失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ========== 余额管理和使用日志 API ==========

// 更新密钥余额上限
router.patch('/keys/:key/balance', async (req, res) => {
  try {
    const { key } = req.params;
    const { maxBalance } = req.body;

    if (maxBalance === undefined || maxBalance === null) {
      return res.status(400).json({ error: '请提供余额上限' });
    }

    const updatedKey = await updateKeyBalance(key, maxBalance);
    await addLog('success', `密钥余额上限已更新: ${key.substring(0, 10)}..., 新额度: ${updatedKey.isUnlimited ? '无限' : '$' + maxBalance}`);

    res.json({
      success: true,
      balance: updatedKey.balance,
      maxBalance: updatedKey.maxBalance,
      isUnlimited: updatedKey.isUnlimited
    });
  } catch (error) {
    await addLog('error', `更新余额上限失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 充值
router.post('/keys/:key/recharge', async (req, res) => {
  try {
    const { key } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: '请提供有效的充值金额' });
    }

    const updatedKey = await addBalance(key, amount);
    await addLog('success', `密钥已充值: ${key.substring(0, 10)}..., 金额: $${amount}`);

    res.json({
      success: true,
      balance: updatedKey.balance,
      maxBalance: updatedKey.maxBalance
    });
  } catch (error) {
    await addLog('error', `充值失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 查询密钥使用日志（管理员）
router.get('/keys/:key/usage', async (req, res) => {
  try {
    const { key } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const result = await getUsageByKey(key, limit, offset);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 查询密钥使用统计（管理员）
router.get('/keys/:key/stats', async (req, res) => {
  try {
    const { key } = req.params;
    const stats = await getUsageStats(key);

    // 也获取key的基本信息
    const keyInfo = await getKey(key);

    res.json({
      ...stats,
      balance: keyInfo?.balance || 0,
      maxBalance: keyInfo?.maxBalance || 0,
      totalSpent: keyInfo?.totalSpent || 0,
      isUnlimited: keyInfo?.isUnlimited || false
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 定价管理 API ==========

// 获取所有模型定价
router.get('/pricing', async (req, res) => {
  try {
    const pricing = await loadPricing();
    res.json(pricing);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新模型定价
router.patch('/pricing/:model', async (req, res) => {
  try {
    const { model } = req.params;
    const { input, output } = req.body;

    if (input === undefined || output === undefined) {
      return res.status(400).json({ error: '请提供输入和输出token价格' });
    }

    const updatedPricing = await updateModelPricing(model, input, output);
    await addLog('success', `模型 ${model} 定价已更新: input=$${input}/M, output=$${output}/M`);

    res.json({
      success: true,
      model,
      pricing: updatedPricing
    });
  } catch (error) {
    await addLog('error', `更新定价失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 添加新模型定价
router.post('/pricing', async (req, res) => {
  try {
    const { model, input, output } = req.body;

    if (!model || input === undefined || output === undefined) {
      return res.status(400).json({ error: '请提供模型名称、输入和输出token价格' });
    }

    const newPricing = await addModelPricing(model, input, output);
    await addLog('success', `新模型 ${model} 定价已添加: input=$${input}/M, output=$${output}/M`);

    res.json({
      success: true,
      model,
      pricing: newPricing
    });
  } catch (error) {
    await addLog('error', `添加定价失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 删除模型定价
router.delete('/pricing/:model', async (req, res) => {
  try {
    const { model } = req.params;
    await deleteModelPricing(model);
    await addLog('info', `模型 ${model} 定价已删除，将使用默认定价`);

    res.json({ success: true });
  } catch (error) {
    await addLog('error', `删除定价失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 重置所有定价为默认值
router.post('/pricing/reset', async (req, res) => {
  try {
    const defaultPricing = await resetPricing();
    await addLog('warn', '所有定价已重置为默认值');

    res.json({
      success: true,
      pricing: defaultPricing
    });
  } catch (error) {
    await addLog('error', `重置定价失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ========== 安全管理 API ==========

// 获取安全统计信息
router.get('/security/stats', async (req, res) => {
  try {
    const stats = await getSecurityStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 检查IP是否被封禁
router.get('/security/check-ip/:ip', async (req, res) => {
  try {
    const { ip } = req.params;
    const banned = await isIPBanned(ip);
    res.json({ ip, banned });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 检查设备是否被封禁
router.get('/security/check-device/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const banned = await isDeviceBanned(deviceId);
    res.json({ deviceId, banned });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 解封IP
router.post('/security/unban-ip', async (req, res) => {
  try {
    const { ip } = req.body;
    if (!ip) {
      return res.status(400).json({ error: '请提供 IP 地址' });
    }

    const result = await unbanIP(ip);
    if (result) {
      await addLog('info', `IP ${ip} 已解封`);
      res.json({ success: true, message: 'IP 已解封' });
    } else {
      res.status(404).json({ error: 'IP 未被封禁' });
    }
  } catch (error) {
    await addLog('error', `解封 IP 失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 解封设备
router.post('/security/unban-device', async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: '请提供设备 ID' });
    }

    const result = await unbanDevice(deviceId);
    if (result) {
      await addLog('info', `设备 ${deviceId} 已解封`);
      res.json({ success: true, message: '设备已解封' });
    } else {
      res.status(404).json({ error: '设备未被封禁' });
    }
  } catch (error) {
    await addLog('error', `解封设备失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ========== 分享管理 API ==========

// ===== 用户封禁系统 =====

// 检查用户是否被封禁
router.get('/share/check-ban/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const banStatus = await isUserBanned(userId);
    res.json(banStatus);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 封禁用户使用共享
router.post('/share/ban-user', async (req, res) => {
  try {
    const { userId, reason } = req.body;
    if (!userId) {
      return res.status(400).json({ error: '请提供用户 ID' });
    }

    const result = await banUserFromSharing(userId, reason);
    await addLog('warn', `用户 ${userId} 被封禁使用共享: ${reason || '滥用共享资源'}`);
    res.json({ success: true, ...result });
  } catch (error) {
    await addLog('error', `封禁用户失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 解除用户封禁
router.post('/share/unban-user', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: '请提供用户 ID' });
    }

    await unbanUser(userId);
    await addLog('info', `用户 ${userId} 的共享封禁已解除`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `解除封禁失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 记录共享使用
router.post('/share/record-usage', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: '请提供用户 ID' });
    }

    const usageCount = await recordShareUsage(userId);
    res.json({ success: true, usageCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取用户平均使用量
router.get('/share/average-usage/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const avgUsage = await getUserAverageUsage(userId);
    res.json({ userId, avgUsage });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 检查并封禁滥用者
router.post('/share/check-abuser', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: '请提供用户 ID' });
    }

    const result = await checkAndBanAbuser(userId);
    if (result.banned) {
      await addLog('warn', `用户 ${userId} 因滥用被自动封禁`);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取用户共享状态
router.get('/share/user-status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const status = await getUserShareStatus(userId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== Token 黑名单系统 =====

// 添加用户到 Token 黑名单
router.post('/share/blacklist/add', async (req, res) => {
  try {
    const { ownerId, tokenIndex, targetUserId } = req.body;
    if (!ownerId || tokenIndex === undefined || !targetUserId) {
      return res.status(400).json({ error: '请提供 ownerId, tokenIndex 和 targetUserId' });
    }

    const blacklist = await addToTokenBlacklist(ownerId, tokenIndex, targetUserId);
    await addLog('info', `用户 ${targetUserId} 被添加到 Token 黑名单`);
    res.json({ success: true, blacklist });
  } catch (error) {
    await addLog('error', `添加黑名单失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 从 Token 黑名单移除用户
router.post('/share/blacklist/remove', async (req, res) => {
  try {
    const { ownerId, tokenIndex, targetUserId } = req.body;
    if (!ownerId || tokenIndex === undefined || !targetUserId) {
      return res.status(400).json({ error: '请提供 ownerId, tokenIndex 和 targetUserId' });
    }

    const blacklist = await removeFromTokenBlacklist(ownerId, tokenIndex, targetUserId);
    await addLog('info', `用户 ${targetUserId} 已从 Token 黑名单移除`);
    res.json({ success: true, blacklist });
  } catch (error) {
    await addLog('error', `移除黑名单失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 检查用户是否在 Token 黑名单中
router.get('/share/blacklist/check/:ownerId/:tokenIndex/:userId', async (req, res) => {
  try {
    const { ownerId, tokenIndex, userId } = req.params;
    const blacklisted = await isUserBlacklisted(ownerId, parseInt(tokenIndex), userId);
    res.json({ blacklisted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取 Token 的黑名单
router.get('/share/blacklist/:ownerId/:tokenIndex', async (req, res) => {
  try {
    const { ownerId, tokenIndex } = req.params;
    const blacklist = await getTokenBlacklist(ownerId, parseInt(tokenIndex));
    res.json({ blacklist });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== 投票封禁系统 =====

// 创建投票
router.post('/share/votes/create', async (req, res) => {
  try {
    const { targetUserId, reason, createdBy } = req.body;
    if (!targetUserId || !reason || !createdBy) {
      return res.status(400).json({ error: '请提供 targetUserId, reason 和 createdBy' });
    }

    const result = await createVote(targetUserId, reason, createdBy);
    if (result.error) {
      return res.status(400).json(result);
    }

    await addLog('info', `用户 ${createdBy} 发起了对 ${targetUserId} 的封禁投票`);
    res.json(result);
  } catch (error) {
    await addLog('error', `创建投票失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 投票
router.post('/share/votes/cast', async (req, res) => {
  try {
    const { voteId, userId, decision } = req.body;
    if (!voteId || !userId || !decision) {
      return res.status(400).json({ error: '请提供 voteId, userId 和 decision' });
    }

    if (!['ban', 'unban'].includes(decision)) {
      return res.status(400).json({ error: 'decision 必须是 ban 或 unban' });
    }

    const result = await castVote(voteId, userId, decision);
    if (result.error) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 添加投票评论
router.post('/share/votes/comment', async (req, res) => {
  try {
    const { voteId, userId, content } = req.body;
    if (!voteId || !userId || !content) {
      return res.status(400).json({ error: '请提供 voteId, userId 和 content' });
    }

    const result = await addVoteComment(voteId, userId, content);
    if (result.error) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 处理投票结果
router.post('/share/votes/process/:voteId', async (req, res) => {
  try {
    const { voteId } = req.params;
    const result = await processVoteResult(voteId);

    if (result.status === 'passed') {
      await addLog('warn', `投票 ${voteId} 通过，执行封禁`);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有活跃投票
router.get('/share/votes/active', async (req, res) => {
  try {
    const votes = await getActiveVotes();
    res.json({ votes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有投票（包括历史）
router.get('/share/votes/all', async (req, res) => {
  try {
    const votes = await getAllVotes();
    res.json({ votes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取投票详情
router.get('/share/votes/:voteId', async (req, res) => {
  try {
    const { voteId } = req.params;
    const vote = await getVoteById(voteId);
    if (!vote) {
      return res.status(404).json({ error: '投票不存在' });
    }
    res.json({ vote });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取用户的投票历史
router.get('/share/votes/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const votes = await getUserVoteHistory(userId);
    res.json({ votes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 用户管理 API（需要认证）==========

// 获取所有用户（管理员）
router.get('/users', async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取用户统计
router.get('/users/stats', async (req, res) => {
  try {
    const stats = await getUserStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取单个用户信息
router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新用户信息
router.patch('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const updates = req.body;
    const user = await updateUser(userId, updates);
    await addLog('info', `用户信息已更新: ${userId}`);
    res.json({ success: true, user });
  } catch (error) {
    await addLog('error', `更新用户失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 删除用户
router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    await deleteUser(userId);
    await addLog('warn', `用户已删除: ${userId}`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `删除用户失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 启用/禁用用户
router.patch('/users/:userId/toggle', async (req, res) => {
  try {
    const { userId } = req.params;
    const { enabled } = req.body;
    await toggleUserStatus(userId, enabled);
    await addLog('info', `用户已${enabled ? '启用' : '禁用'}: ${userId}`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `切换用户状态失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ===== 用户 API 密钥管理 =====

// 获取用户的API密钥列表
router.get('/users/:userId/api-keys', async (req, res) => {
  try {
    const { userId } = req.params;
    const keys = await getUserApiKeys(userId);
    res.json({ keys });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 为用户生成API密钥
router.post('/users/:userId/api-keys', async (req, res) => {
  try {
    const { userId } = req.params;
    const { name } = req.body;
    const key = await generateUserApiKey(userId, name);
    await addLog('success', `用户 ${userId} 创建了新API密钥: ${name}`);
    res.json({ success: true, key });
  } catch (error) {
    await addLog('error', `生成API密钥失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 删除用户的API密钥
router.delete('/users/:userId/api-keys/:keyId', async (req, res) => {
  try {
    const { userId, keyId } = req.params;
    await deleteUserApiKey(userId, keyId);
    await addLog('info', `用户 ${userId} 删除了API密钥: ${keyId}`);
    res.json({ success: true });
  } catch (error) {
    await addLog('error', `删除API密钥失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 验证用户API密钥
router.post('/users/validate-api-key', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: '请提供API密钥' });
    }

    const result = await validateUserApiKey(apiKey);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== 用户 Google Token 管理 =====

// 获取用户的Google Tokens
router.get('/users/:userId/tokens', async (req, res) => {
  try {
    const { userId } = req.params;
    const tokens = await getUserTokens(userId);
    res.json({ tokens });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 为用户添加Google Token
router.post('/users/:userId/tokens', async (req, res) => {
  try {
    const { userId } = req.params;
    const tokenData = req.body;
    const result = await addUserToken(userId, tokenData);
    await addLog('success', `用户 ${userId} 添加了新Token`);
    res.json(result);
  } catch (error) {
    await addLog('error', `添加Token失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 删除用户的Google Token
router.delete('/users/:userId/tokens/:tokenIndex', async (req, res) => {
  try {
    const { userId, tokenIndex } = req.params;
    const result = await deleteUserToken(userId, parseInt(tokenIndex));
    await addLog('info', `用户 ${userId} 删除了Token #${tokenIndex}`);
    res.json(result);
  } catch (error) {
    await addLog('error', `删除Token失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 获取用户的可用Token
router.get('/users/:userId/available-token', async (req, res) => {
  try {
    const { userId } = req.params;
    const token = await getUserAvailableToken(userId);
    if (!token) {
      return res.status(404).json({ error: '没有可用的Token' });
    }
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== AI 审核系统 API ==========

// 获取AI配置
router.get('/ai-moderator/config', async (req, res) => {
  try {
    const config = await loadAIConfig();
    // 隐藏API密钥
    const safeConfig = {
      ...config,
      apiKey: config.apiKey ? '***已配置***' : ''
    };
    res.json(safeConfig);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新AI配置
router.post('/ai-moderator/config', async (req, res) => {
  try {
    const config = req.body;

    // 如果API密钥是占位符,保留原密钥
    if (config.apiKey === '***已配置***') {
      const oldConfig = await loadAIConfig();
      config.apiKey = oldConfig.apiKey;
    }

    await saveAIConfig(config);
    await addLog('success', 'AI审核配置已更新');

    // 重启调度器应用新配置
    await restartAIScheduler();

    res.json({ success: true, message: '配置已保存并应用' });
  } catch (error) {
    await addLog('error', `保存AI配置失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 手动触发AI审核
router.post('/ai-moderator/run', async (req, res) => {
  try {
    await addLog('info', '手动触发AI审核');
    const result = await runAIModeration(true);
    res.json(result);
  } catch (error) {
    await addLog('error', `AI审核失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 获取AI审核日志
router.get('/ai-moderator/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const logs = await getAIModerationLogs(limit);
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取AI审核统计
router.get('/ai-moderator/stats', async (req, res) => {
  try {
    const stats = await getAIStatistics();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动AI调度器
router.post('/ai-moderator/scheduler/start', async (req, res) => {
  try {
    startAIScheduler();
    await addLog('success', 'AI调度器已启动');
    res.json({ success: true, message: 'AI调度器已启动' });
  } catch (error) {
    await addLog('error', `启动AI调度器失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 停止AI调度器
router.post('/ai-moderator/scheduler/stop', async (req, res) => {
  try {
    stopAIScheduler();
    await addLog('info', 'AI调度器已停止');
    res.json({ success: true, message: 'AI调度器已停止' });
  } catch (error) {
    await addLog('error', `停止AI调度器失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 重启AI调度器
router.post('/ai-moderator/scheduler/restart', async (req, res) => {
  try {
    await restartAIScheduler();
    await addLog('info', 'AI调度器已重启');
    res.json({ success: true, message: 'AI调度器已重启' });
  } catch (error) {
    await addLog('error', `重启AI调度器失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ========== 文件系统操作API（用于Gemini CLI等工具）==========

// 读取文件内容
router.post('/read-file', adminAuth, async (req, res) => {
  try {
    // 参数别名支持 - 同时支持 path 和 file_path
    const filePath = req.body.file_path || req.body.path;

    if (!filePath) {
      return res.status(400).json({
        error: '缺少必需参数: file_path 或 path'
      });
    }

    // 安全检查 - 防止路径遍历攻击
    const safePath = path.resolve(process.cwd(), filePath);
    if (!safePath.startsWith(process.cwd())) {
      await addLog('warn', `文件访问被拒绝 - 路径越界: ${filePath}`);
      return res.status(403).json({
        error: '禁止访问该路径'
      });
    }

    // 读取文件
    const content = await fs.readFile(safePath, 'utf-8');

    await addLog('info', `读取文件: ${filePath}`);
    res.json({
      success: true,
      file_path: filePath,
      content
    });
  } catch (error) {
    await addLog('error', `读取文件失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 读取目录内容
router.post('/read-folder', adminAuth, async (req, res) => {
  try {
    // 参数别名支持 - 同时支持 path 和 dir_path
    const dirPath = req.body.dir_path || req.body.path;

    if (!dirPath) {
      return res.status(400).json({
        error: '缺少必需参数: dir_path 或 path'
      });
    }

    // 安全检查 - 防止路径遍历攻击
    const safePath = path.resolve(process.cwd(), dirPath);
    if (!safePath.startsWith(process.cwd())) {
      await addLog('warn', `目录访问被拒绝 - 路径越界: ${dirPath}`);
      return res.status(403).json({
        error: '禁止访问该路径'
      });
    }

    // 读取目录
    const files = await fs.readdir(safePath, { withFileTypes: true });

    const items = files.map(file => ({
      name: file.name,
      type: file.isDirectory() ? 'directory' : 'file',
      path: path.join(dirPath, file.name)
    }));

    await addLog('info', `读取目录: ${dirPath} (${items.length} 项)`);
    res.json({
      success: true,
      dir_path: dirPath,
      items
    });
  } catch (error) {
    await addLog('error', `读取目录失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 编辑文件内容
router.post('/edit-file', adminAuth, async (req, res) => {
  try {
    // 参数别名支持 - 同时支持 path 和 file_path
    const filePath = req.body.file_path || req.body.path;
    const oldString = req.body.old_string;
    const newString = req.body.new_string;

    if (!filePath) {
      return res.status(400).json({
        error: '缺少必需参数: file_path 或 path'
      });
    }

    if (oldString === undefined || newString === undefined) {
      return res.status(400).json({
        error: '缺少必需参数: old_string 和 new_string'
      });
    }

    // 安全检查 - 防止路径遍历攻击
    const safePath = path.resolve(process.cwd(), filePath);
    if (!safePath.startsWith(process.cwd())) {
      await addLog('warn', `文件编辑被拒绝 - 路径越界: ${filePath}`);
      return res.status(403).json({
        error: '禁止访问该路径'
      });
    }

    // 读取文件
    const content = await fs.readFile(safePath, 'utf-8');

    // 检查 old_string 是否存在
    if (!content.includes(oldString)) {
      return res.status(400).json({
        error: '文件中未找到要替换的内容',
        file_path: filePath
      });
    }

    // 替换内容
    const newContent = content.replace(oldString, newString);

    // 写入文件
    await fs.writeFile(safePath, newContent, 'utf-8');

    await addLog('info', `编辑文件: ${filePath}`);
    res.json({
      success: true,
      file_path: filePath,
      message: '文件已成功编辑'
    });
  } catch (error) {
    await addLog('error', `编辑文件失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 写入文件内容
router.post('/write-file', adminAuth, async (req, res) => {
  try {
    // 参数别名支持 - 同时支持 path 和 file_path
    const filePath = req.body.file_path || req.body.path;
    const content = req.body.content;

    if (!filePath) {
      return res.status(400).json({
        error: '缺少必需参数: file_path 或 path'
      });
    }

    if (content === undefined) {
      return res.status(400).json({
        error: '缺少必需参数: content'
      });
    }

    // 安全检查 - 防止路径遍历攻击
    const safePath = path.resolve(process.cwd(), filePath);
    if (!safePath.startsWith(process.cwd())) {
      await addLog('warn', `文件写入被拒绝 - 路径越界: ${filePath}`);
      return res.status(403).json({
        error: '禁止访问该路径'
      });
    }

    // 写入文件
    await fs.writeFile(safePath, content, 'utf-8');

    await addLog('info', `写入文件: ${filePath}`);
    res.json({
      success: true,
      file_path: filePath,
      message: '文件已成功写入'
    });
  } catch (error) {
    await addLog('error', `写入文件失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 执行受限的 Shell 命令
router.post('/run-command', adminAuth, async (req, res) => {
  try {
    const { command } = req.body;

    if (!command) {
      return res.status(400).json({
        error: '缺少必需参数: command'
      });
    }

    // 命令白名单 - 只允许安全的命令
    const allowedCommands = [
      /^git\s+/,           // git 命令
      /^npm\s+/,           // npm 命令
      /^node\s+/,          // node 命令
      /^ls(\s+|$)/,        // ls 命令
      /^dir(\s+|$)/,       // dir 命令 (Windows)
      /^pwd$/,             // pwd 命令
      /^cd\s+/,            // cd 命令
      /^echo\s+/           // echo 命令
    ];

    // 检查命令是否在白名单中
    const isAllowed = allowedCommands.some(pattern => pattern.test(command));

    if (!isAllowed) {
      await addLog('warn', `命令被拒绝 - 不在白名单中: ${command}`);
      return res.status(403).json({
        error: '不允许执行此命令。仅允许: git, npm, node, ls, dir, pwd, cd, echo'
      });
    }

    // 检查危险模式
    const dangerousPatterns = [
      /rm\s+-rf/,          // rm -rf
      /del\s+\/[SF]/,      // Windows del /S /F
      /format/i,           // format 命令
      />.*passwd/,         // 重定向到 passwd
      />\s*\/dev\//,       // 重定向到设备文件
      /\|\s*sh/,           // 管道到 sh
      /\|\s*bash/,         // 管道到 bash
      /`.*`/,              // 反引号命令替换
      /\$\(.*\)/          // $() 命令替换
    ];

    const isDangerous = dangerousPatterns.some(pattern => pattern.test(command));

    if (isDangerous) {
      await addLog('error', `危险命令被阻止: ${command}`);
      return res.status(403).json({
        error: '检测到潜在危险操作，命令被阻止'
      });
    }

    // 执行命令
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    await addLog('info', `执行命令: ${command}`);

    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      timeout: 30000, // 30秒超时
      maxBuffer: 1024 * 1024 // 1MB 输出限制
    });

    res.json({
      success: true,
      stdout: stdout || '',
      stderr: stderr || '',
      command
    });

  } catch (error) {
    await addLog('error', `命令执行失败: ${error.message}`);

    // 返回错误信息，但要安全地处理
    res.status(500).json({
      error: error.message,
      stdout: error.stdout || '',
      stderr: error.stderr || ''
    });
  }
});

// ========== 管理员管理相关（需要管理员认证）==========

// 获取所有管理员列表
router.get('/admin/list', adminAuth, async (req, res) => {
  try {
    const admins = getAllAdmins();
    res.json({ admins });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建新管理员
router.post('/admin/create', adminAuth, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const result = createAdmin(username, password);
    await addLog('success', `创建新管理员: ${username}`);
    res.json(result);
  } catch (error) {
    await addLog('error', `创建管理员失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 删除管理员
router.delete('/admin/:username', adminAuth, async (req, res) => {
  try {
    const { username } = req.params;
    const result = deleteAdmin(username);
    await addLog('warn', `删除管理员: ${username}`);
    res.json(result);
  } catch (error) {
    await addLog('error', `删除管理员失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 修改管理员密码
router.post('/admin/change-password', adminAuth, async (req, res) => {
  try {
    const { username, oldPassword, newPassword } = req.body;

    if (!username || !oldPassword || !newPassword) {
      return res.status(400).json({ error: '所有字段都不能为空' });
    }

    const result = changeAdminPassword(username, oldPassword, newPassword);
    await addLog('info', `管理员 ${username} 修改了密码`);
    res.json(result);
  } catch (error) {
    await addLog('error', `修改密码失败: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 获取管理员信息
router.get('/admin/info/:username', adminAuth, async (req, res) => {
  try {
    const { username } = req.params;
    const info = getAdminInfo(username);
    res.json(info);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

export default router;
export { incrementRequestCount, addLog };
