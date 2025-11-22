import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from '../utils/logger.js';
import proxyManager from '../admin/proxy_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const CLIENT_SECRET = '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';

class TokenManager {
  constructor(filePath = path.join(__dirname,'..','..','data' ,'accounts.json')) {
    this.filePath = filePath;
    this.tokens = [];
    this.lastLoadTime = 0;
    this.loadInterval = 60000; // 1分钟内不重复加载
    this.cachedData = null; // 缓存文件数据，减少磁盘读取

    // 粘性会话管理
    this.sessionBindings = new Map(); // sessionId -> { tokenIndex, lastAccessTime, refreshToken }
    this.tokenSessions = new Map(); // refreshToken -> sessionId

    // 会话超时配置（30分钟）
    this.SESSION_TIMEOUT = 30 * 60 * 1000;

    // 使用统计
    this.usageStats = new Map(); // refresh_token -> { requests, lastUsed }

    this.loadTokens();

    // 启动定时任务
    this.startSessionCleanup();
    this.startQuotaResetCheck();
  }

  loadTokens(force = false) {
    try {
      // 避免频繁加载，1分钟内使用缓存（除非强制刷新）
      if (!force && Date.now() - this.lastLoadTime < this.loadInterval && this.tokens.length > 0) {
        return;
      }

      log.info('正在加载token...');
      const data = fs.readFileSync(this.filePath, 'utf8');
      const tokenArray = JSON.parse(data);
      this.cachedData = tokenArray; // 缓存原始数据

      // 只加载已启用的token
      this.tokens = tokenArray.filter(token => token.enable !== false);

      this.lastLoadTime = Date.now();
      log.info(`成功加载 ${this.tokens.length} 个可用token`);

      // 触发垃圾回收（如果可用）
      if (global.gc) {
        global.gc();
      }
    } catch (error) {
      log.error('加载token失败:', error.message);
      this.tokens = [];
    }
  }

  // 强制重新加载token（绕过缓存）
  forceReload() {
    this.loadTokens(true);
  }

  isExpired(token) {
    if (!token.timestamp || !token.expires_in) return true;
    const expiresAt = token.timestamp + (token.expires_in * 1000);
    return Date.now() >= expiresAt - 300000;
  }

  async refreshToken(token) {
    log.info('正在刷新token...');
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token
    });

    // 获取代理配置
    const fetchOptions = {
      method: 'POST',
      headers: {
        'Host': 'oauth2.googleapis.com',
        'User-Agent': 'Go-http-client/1.1',
        'Content-Length': body.toString().length.toString(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Encoding': 'gzip'
      },
      body: body.toString()
    };

    // 如果token配置了代理，使用代理
    if (token.proxyId) {
      const proxy = proxyManager.getProxyById(token.proxyId);
      if (proxy && proxy.enabled) {
        const agent = await proxyManager.createProxyAgent(proxy);
        if (agent) {
          fetchOptions.agent = agent;
          log.info(`使用代理: ${proxy.name}`);
        }
      }
    }

    const response = await fetch('https://oauth2.googleapis.com/token', fetchOptions);

    if (response.ok) {
      const data = await response.json();
      token.access_token = data.access_token;
      token.expires_in = data.expires_in;
      token.timestamp = Date.now();
      this.saveToFile();
      return token;
    } else {
      throw { statusCode: response.status, message: await response.text() };
    }
  }

  saveToFile() {
    try {
      // 使用缓存数据，减少磁盘读取
      let allTokens = this.cachedData;
      if (!allTokens) {
        const data = fs.readFileSync(this.filePath, 'utf8');
        allTokens = JSON.parse(data);
      }

      this.tokens.forEach(memToken => {
        const index = allTokens.findIndex(t => t.refresh_token === memToken.refresh_token);
        if (index !== -1) allTokens[index] = memToken;
      });

      fs.writeFileSync(this.filePath, JSON.stringify(allTokens, null, 2), 'utf8');
      this.cachedData = allTokens; // 更新缓存
    } catch (error) {
      log.error('保存文件失败:', error.message);
    }
  }

  // ========== 粘性会话机制 ==========

  /**
   * 根据 sessionId 获取或分配 token
   * @param {string} sessionId - 会话ID
   * @returns {Promise<Object>} - Token对象
   */
  async getTokenForSession(sessionId) {
    if (!sessionId) {
      throw new Error('Session ID is required');
    }

    // 1. 检查是否已有绑定
    if (this.sessionBindings.has(sessionId)) {
      const binding = this.sessionBindings.get(sessionId);
      binding.lastAccessTime = Date.now();

      const token = this.tokens.find(t => t.refresh_token === binding.refreshToken);

      if (token && token.enable !== false && !this.isTokenDisabledByQuota(token)) {
        // Token 可用，刷新如果过期
        if (this.isExpired(token)) {
          await this.refreshToken(token);
        }

        // 记录使用统计
        this.recordUsage(token);
        log.info(`🔗 Session ${sessionId.substring(0, 8)}... 使用已绑定的 Token (总请求: ${this.getTokenRequests(token)})`);

        return token;
      } else {
        // Token 已被禁用或不可用，释放绑定并重新分配
        log.warn(`Token for session ${sessionId.substring(0, 8)}... is disabled, releasing and reassigning`);
        this.releaseSession(sessionId);
      }
    }

    // 2. 分配一个空闲的 token
    const freeToken = this.findFreeToken();
    if (!freeToken) {
      throw new Error('No available tokens. All tokens are either in use or disabled.');
    }

    // 3. 刷新 token 如果需要
    if (this.isExpired(freeToken.token)) {
      await this.refreshToken(freeToken.token);
    }

    // 4. 建立绑定
    this.sessionBindings.set(sessionId, {
      tokenIndex: freeToken.index,
      refreshToken: freeToken.token.refresh_token,
      lastAccessTime: Date.now()
    });
    this.tokenSessions.set(freeToken.token.refresh_token, sessionId);

    // 记录使用统计
    this.recordUsage(freeToken.token);
    log.info(`🆕 Session ${sessionId.substring(0, 8)}... 绑定到新 Token #${freeToken.index}`);

    return freeToken.token;
  }

  /**
   * 查找空闲的 token
   * @returns {Object|null} - { index, token } 或 null
   */
  findFreeToken() {
    for (let i = 0; i < this.tokens.length; i++) {
      const token = this.tokens[i];

      // 跳过禁用的 token
      if (token.enable === false) continue;

      // 跳过配额耗尽的 token
      if (this.isTokenDisabledByQuota(token)) continue;

      // 检查是否已被其他 session 使用
      if (!this.tokenSessions.has(token.refresh_token)) {
        return { index: i, token };
      }
    }
    return null;
  }

  /**
   * 检查 token 是否因配额耗尽而被禁用
   */
  isTokenDisabledByQuota(token) {
    return token.disabledUntil && Date.now() < token.disabledUntil;
  }

  /**
   * 释放 session 绑定
   * @param {string} sessionId - 会话ID
   */
  releaseSession(sessionId) {
    const binding = this.sessionBindings.get(sessionId);
    if (binding) {
      this.tokenSessions.delete(binding.refreshToken);
      this.sessionBindings.delete(sessionId);
      log.info(`🔓 Session ${sessionId.substring(0, 8)}... 已释放`);
    }
  }

  /**
   * 定时清理过期 session
   */
  startSessionCleanup() {
    setInterval(() => {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [sessionId, binding] of this.sessionBindings.entries()) {
        if (now - binding.lastAccessTime > this.SESSION_TIMEOUT) {
          this.releaseSession(sessionId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        log.info(`🧹 清理了 ${cleanedCount} 个过期会话`);
      }
    }, 60000); // 每分钟检查一次
  }

  // ========== 配额管理 ==========

  /**
   * 将 token 禁用到指定时间（配额重置时间）
   */
  disableTokenUntil(token, resetTime) {
    token.disabledUntil = resetTime;
    token.quotaExhausted = true; // 标记为配额耗尽
    this.saveToFile();

    // 释放这个 token 的 session 绑定
    const sessionId = this.tokenSessions.get(token.refresh_token);
    if (sessionId) {
      this.releaseSession(sessionId);
    }

    const resetDate = new Date(resetTime);
    log.warn(`⏸️  Token 因配额耗尽被禁用，将在 ${resetDate.toLocaleString()} 自动恢复`);
  }

  /**
   * 永久禁用 token
   */
  disableToken(token) {
    log.warn(`❌ 永久禁用 token`);
    token.enable = false;
    delete token.disabledUntil;
    delete token.quotaExhausted;
    this.saveToFile();

    // 释放这个 token 的 session 绑定
    const sessionId = this.tokenSessions.get(token.refresh_token);
    if (sessionId) {
      this.releaseSession(sessionId);
    }

    this.loadTokens(true); // 强制刷新
  }

  /**
   * 定时检查并恢复配额已重置的 token
   */
  startQuotaResetCheck() {
    setInterval(() => {
      const now = Date.now();
      let restoredCount = 0;

      // 需要更新缓存数据中的 token
      if (this.cachedData) {
        this.cachedData.forEach(token => {
          if (token.disabledUntil && now >= token.disabledUntil) {
            delete token.disabledUntil;
            delete token.quotaExhausted;
            restoredCount++;
          }
        });

        if (restoredCount > 0) {
          this.saveToFile();
          this.loadTokens(true);
          log.info(`✅ 恢复了 ${restoredCount} 个配额已重置的 token`);
        }
      }
    }, 60000); // 每分钟检查一次
  }

  /**
   * 处理请求错误（检测配额耗尽）
   */
  async handleRequestError(error, token, sessionId) {
    // 配额耗尽错误
    if (error.statusCode === 429 || (error.message && error.message.includes('quota'))) {
      log.warn(`🚫 Token 配额耗尽: ${error.message}`);

      // 禁用到明天UTC 0点重置
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(0, 0, 0, 0);

      this.disableTokenUntil(token, tomorrow.getTime());

      // 如果有 sessionId，尝试为这个 session 重新分配 token
      if (sessionId) {
        return await this.getTokenForSession(sessionId);
      }

      throw error;
    }

    // 403 错误 - 永久禁用
    if (error.statusCode === 403) {
      log.warn(`🚫 Token 遇到 403 错误，永久禁用`);
      this.disableToken(token);

      // 如果有 sessionId，尝试为这个 session 重新分配 token
      if (sessionId) {
        return await this.getTokenForSession(sessionId);
      }

      throw error;
    }

    throw error;
  }

  // ========== 统计和监控 ==========

  /**
   * 记录 Token 使用
   */
  recordUsage(token) {
    const key = token.refresh_token;
    if (!this.usageStats.has(key)) {
      this.usageStats.set(key, { requests: 0, lastUsed: null });
    }
    const stats = this.usageStats.get(key);
    stats.requests++;
    stats.lastUsed = Date.now();
  }

  /**
   * 获取单个 Token 的请求次数
   */
  getTokenRequests(token) {
    const stats = this.usageStats.get(token.refresh_token);
    return stats ? stats.requests : 0;
  }

  /**
   * 获取所有 Token 的使用统计
   */
  getUsageStats() {
    const stats = [];
    this.tokens.forEach((token, index) => {
      const usage = this.usageStats.get(token.refresh_token) || { requests: 0, lastUsed: null };
      const sessionId = this.tokenSessions.get(token.refresh_token);

      stats.push({
        index,
        requests: usage.requests,
        lastUsed: usage.lastUsed ? new Date(usage.lastUsed).toISOString() : null,
        inUse: !!sessionId,
        sessionId: sessionId || null,
        quotaExhausted: !!token.quotaExhausted,
        disabledUntil: token.disabledUntil ? new Date(token.disabledUntil).toISOString() : null
      });
    });
    return {
      totalTokens: this.tokens.length,
      availableTokens: this.tokens.filter(t => !this.tokenSessions.has(t.refresh_token) && !this.isTokenDisabledByQuota(t)).length,
      activeSessions: this.sessionBindings.size,
      totalRequests: Array.from(this.usageStats.values()).reduce((sum, s) => sum + s.requests, 0),
      tokens: stats
    };
  }

  /**
   * 获取所有 session 绑定信息
   */
  getSessionBindings() {
    const bindings = [];
    for (const [sessionId, binding] of this.sessionBindings.entries()) {
      const token = this.tokens.find(t => t.refresh_token === binding.refreshToken);
      const usage = this.usageStats.get(binding.refreshToken) || { requests: 0 };

      bindings.push({
        sessionId,
        tokenIndex: binding.tokenIndex,
        refreshToken: binding.refreshToken.substring(0, 20) + '...',
        lastAccessTime: binding.lastAccessTime,
        idleTime: Math.floor((Date.now() - binding.lastAccessTime) / 1000),
        requests: usage.requests,
        willExpireIn: Math.floor((this.SESSION_TIMEOUT - (Date.now() - binding.lastAccessTime)) / 1000)
      });
    }
    return bindings;
  }

  // ========== 兼容旧接口 ==========

  /**
   * @deprecated 使用 getTokenForSession 代替
   */
  async getToken() {
    log.warn('getToken() is deprecated. Use getTokenForSession(sessionId) instead.');
    // 生成一个临时的 sessionId
    const tempSessionId = `temp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    return await this.getTokenForSession(tempSessionId);
  }

  disableCurrentToken(token) {
    const found = this.tokens.find(t => t.access_token === token.access_token);
    if (found) {
      this.disableToken(found);
    }
  }
}

const tokenManager = new TokenManager();
export default tokenManager;
