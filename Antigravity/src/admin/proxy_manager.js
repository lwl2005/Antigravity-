import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';

const PROXY_POOL_FILE = path.join(process.cwd(), 'data', 'proxy_pool.json');

// 代理池管理类
class ProxyManager {
  constructor() {
    this.proxyPool = [];
    this.loadProxyPool();
  }

  // 加载代理池
  async loadProxyPool() {
    try {
      const data = await fs.readFile(PROXY_POOL_FILE, 'utf-8');
      this.proxyPool = JSON.parse(data);
      logger.info(`成功加载 ${this.proxyPool.length} 个代理`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // 文件不存在，创建空代理池
        this.proxyPool = [];
        await this.saveProxyPool();
        logger.info('代理池文件不存在，已创建空代理池');
      } else {
        logger.error('加载代理池失败:', error.message);
        this.proxyPool = [];
      }
    }
  }

  // 保存代理池
  async saveProxyPool() {
    try {
      const dir = path.dirname(PROXY_POOL_FILE);
      try {
        await fs.access(dir);
      } catch {
        await fs.mkdir(dir, { recursive: true });
      }
      await fs.writeFile(PROXY_POOL_FILE, JSON.stringify(this.proxyPool, null, 2), 'utf-8');
      logger.info('代理池已保存');
    } catch (error) {
      logger.error('保存代理池失败:', error.message);
      throw error;
    }
  }

  // 获取所有代理
  getAllProxies() {
    return this.proxyPool;
  }

  // 添加代理
  async addProxy(proxyConfig) {
    const proxy = {
      id: Date.now().toString(),
      name: proxyConfig.name || '未命名代理',
      protocol: proxyConfig.protocol || 'socks5',
      host: proxyConfig.host,
      port: proxyConfig.port,
      username: proxyConfig.username || null,
      password: proxyConfig.password || null,
      enabled: proxyConfig.enabled !== false,
      created: new Date().toISOString(),
      lastTested: null,
      testStatus: null
    };

    this.proxyPool.push(proxy);
    await this.saveProxyPool();
    logger.info(`代理已添加: ${proxy.name} (${proxy.host}:${proxy.port})`);
    return proxy;
  }

  // 更新代理
  async updateProxy(id, updates) {
    const index = this.proxyPool.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error('代理不存在');
    }

    this.proxyPool[index] = {
      ...this.proxyPool[index],
      ...updates,
      id: this.proxyPool[index].id, // 保持ID不变
      created: this.proxyPool[index].created // 保持创建时间不变
    };

    await this.saveProxyPool();
    logger.info(`代理已更新: ${id}`);
    return this.proxyPool[index];
  }

  // 删除代理
  async deleteProxy(id) {
    const index = this.proxyPool.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error('代理不存在');
    }

    const deleted = this.proxyPool.splice(index, 1)[0];
    await this.saveProxyPool();
    logger.info(`代理已删除: ${deleted.name}`);
    return deleted;
  }

  // 根据ID获取代理
  getProxyById(id) {
    return this.proxyPool.find(p => p.id === id);
  }

  // 创建代理Agent
  async createProxyAgent(proxyConfig) {
    if (!proxyConfig || !proxyConfig.enabled) {
      return null;
    }

    const { protocol, host, port, username, password } = proxyConfig;

    let proxyUrl;
    if (username && password) {
      proxyUrl = `${protocol}://${username}:${password}@${host}:${port}`;
    } else {
      proxyUrl = `${protocol}://${host}:${port}`;
    }

    try {
      if (protocol === 'socks5' || protocol === 'socks4') {
        // 动态导入socks-proxy-agent
        const { SocksProxyAgent } = await import('socks-proxy-agent');
        return new SocksProxyAgent(proxyUrl);
      } else if (protocol === 'http' || protocol === 'https') {
        // HTTP代理使用内置的代理支持
        return null; // 稍后在fetch中处理
      } else {
        logger.warn(`不支持的代理协议: ${protocol}`);
        return null;
      }
    } catch (error) {
      logger.error('创建代理Agent失败:', error.message);
      return null;
    }
  }

  // 测试代理连接
  async testProxy(proxyConfig) {
    const startTime = Date.now();

    try {
      const agent = await this.createProxyAgent(proxyConfig);
      const testUrl = 'https://www.google.com';

      const fetchOptions = {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 10000 // 10秒超时
      };

      if (agent) {
        fetchOptions.agent = agent;
      }

      const response = await fetch(testUrl, fetchOptions);
      const latency = Date.now() - startTime;

      const result = {
        success: response.ok,
        status: response.status,
        latency: latency,
        message: response.ok ? '连接成功' : `HTTP ${response.status}`,
        timestamp: new Date().toISOString()
      };

      // 更新代理池中的测试状态
      if (proxyConfig.id) {
        await this.updateProxy(proxyConfig.id, {
          lastTested: result.timestamp,
          testStatus: result.success ? 'success' : 'failed'
        });
      }

      return result;
    } catch (error) {
      const latency = Date.now() - startTime;

      const result = {
        success: false,
        status: 0,
        latency: latency,
        message: error.message,
        timestamp: new Date().toISOString()
      };

      // 更新代理池中的测试状态
      if (proxyConfig.id) {
        try {
          await this.updateProxy(proxyConfig.id, {
            lastTested: result.timestamp,
            testStatus: 'failed'
          });
        } catch (e) {
          // 忽略更新错误
        }
      }

      return result;
    }
  }

  // 批量测试所有代理
  async testAllProxies() {
    const results = [];
    for (const proxy of this.proxyPool) {
      if (proxy.enabled) {
        const result = await this.testProxy(proxy);
        results.push({
          id: proxy.id,
          name: proxy.name,
          ...result
        });
      } else {
        results.push({
          id: proxy.id,
          name: proxy.name,
          success: false,
          message: '代理已禁用',
          latency: 0
        });
      }
    }
    return results;
  }
}

const proxyManager = new ProxyManager();
export default proxyManager;
