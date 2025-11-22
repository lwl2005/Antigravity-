import fs from 'fs/promises';
import AdmZip from 'adm-zip';
import path from 'path';
import { spawn } from 'child_process';
import logger from '../utils/logger.js';
import tokenManager from '../auth/token_manager.js';

const ACCOUNTS_FILE = path.join(process.cwd(), 'data', 'accounts.json');

// 读取所有账号
export async function loadAccounts() {
  try {
    const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// 保存账号
async function saveAccounts(accounts) {
  const dir = path.dirname(ACCOUNTS_FILE);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
}

// 删除账号
export async function deleteAccount(index) {
  const accounts = await loadAccounts();
  if (index < 0 || index >= accounts.length) {
    throw new Error('无效的账号索引');
  }
  accounts.splice(index, 1);
  await saveAccounts(accounts);
  tokenManager.forceReload(); // 强制刷新token管理器
  logger.info(`账号 ${index} 已删除，token管理器已刷新`);
  return true;
}

// 启用/禁用账号
export async function toggleAccount(index, enable) {
  const accounts = await loadAccounts();
  if (index < 0 || index >= accounts.length) {
    throw new Error('无效的账号索引');
  }
  accounts[index].enable = enable;
  await saveAccounts(accounts);
  tokenManager.forceReload(); // 强制刷新token管理器
  logger.info(`账号 ${index} 已${enable ? '启用' : '禁用'}，token管理器已刷新`);
  return true;
}

// 设置token的代理
export async function setTokenProxy(index, proxyId) {
  const accounts = await loadAccounts();
  if (index < 0 || index >= accounts.length) {
    throw new Error('无效的账号索引');
  }
  accounts[index].proxyId = proxyId || null;
  await saveAccounts(accounts);
  tokenManager.forceReload(); // 强制刷新token管理器
  logger.info(`账号 ${index} 的代理已设置为: ${proxyId || '无'}`);
  return true;
}

// 检查并清理 OAuth 端口
async function cleanupOAuthPort() {
  const OAUTH_PORT = 8099;
  try {
    // 尝试使用 npx kill-port 清理端口
    await new Promise((resolve, reject) => {
      const killProcess = spawn('npx', ['kill-port', OAUTH_PORT.toString()], {
        stdio: 'pipe'
      });

      killProcess.on('close', (code) => {
        // 无论成功或失败都继续，因为端口可能本来就没被占用
        resolve();
      });

      killProcess.on('error', () => {
        // 忽略错误，继续执行
        resolve();
      });

      // 最多等待 2 秒
      setTimeout(resolve, 2000);
    });

    logger.info('OAuth 端口清理完成');
  } catch (error) {
    // 忽略错误
    logger.warn('OAuth 端口清理时出现问题，继续尝试启动');
  }
}

// 触发登录流程
export async function triggerLogin() {
  // 先清理可能占用的端口
  await cleanupOAuthPort();

  return new Promise((resolve, reject) => {
    logger.info('启动登录流程...');

    const loginScript = path.join(process.cwd(), 'scripts', 'oauth-server.js');
    // 移除 shell: true 以避免安全警告
    const child = spawn('node', [loginScript], {
      stdio: 'pipe'
    });

    let authUrl = '';
    let output = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;

      // 提取授权 URL
      const urlMatch = text.match(/(https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?[^\s]+)/);
      if (urlMatch) {
        authUrl = urlMatch[1];
      }

      logger.info(text.trim());
    });

    child.stderr.on('data', (data) => {
      logger.error(data.toString().trim());
    });

    child.on('close', (code) => {
      if (code === 0) {
        logger.info('登录流程完成');
        resolve({ success: true, authUrl, message: '登录成功' });
      } else {
        reject(new Error('登录流程失败'));
      }
    });

    // 5 秒后返回授权 URL，不等待完成
    setTimeout(() => {
      if (authUrl) {
        resolve({ success: true, authUrl, message: '请在浏览器中完成授权' });
      }
    }, 5000);

    child.on('error', (error) => {
      reject(error);
    });
  });
}

// 获取账号统计信息
export async function getAccountStats() {
  const accounts = await loadAccounts();
  return {
    total: accounts.length,
    enabled: accounts.filter(a => a.enable !== false).length,
    disabled: accounts.filter(a => a.enable === false).length
  };
}

// 从回调链接手动添加 Token
import https from 'https';

const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const CLIENT_SECRET = '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';

// 获取 Google 账号信息
export async function getAccountName(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.googleapis.com',
      path: '/oauth2/v2/userinfo',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const data = JSON.parse(body);
          resolve({
            email: data.email,
            name: data.name || data.email
          });
        } else {
          resolve({ email: 'Unknown', name: 'Unknown' });
        }
      });
    });

    req.on('error', () => resolve({ email: 'Unknown', name: 'Unknown' }));
    req.end();
  });
}

export async function addTokenFromCallback(callbackUrl) {
  // 解析回调链接
  const url = new URL(callbackUrl);
  const code = url.searchParams.get('code');
  const port = url.port || '80';

  if (!code) {
    throw new Error('回调链接中没有找到授权码 (code)');
  }

  logger.info(`正在使用授权码换取 Token...`);

  // 使用授权码换取 Token
  const tokenData = await exchangeCodeForToken(code, port, url.origin);

  // 保存账号
  const account = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_in: tokenData.expires_in,
    timestamp: Date.now(),
    enable: true
  };

  const accounts = await loadAccounts();
  accounts.push(account);
  await saveAccounts(accounts);
  tokenManager.forceReload(); // 强制刷新token管理器

  logger.info('Token 已成功保存，token管理器已刷新');
  return { success: true, message: 'Token 已成功添加' };
}

function exchangeCodeForToken(code, port, origin) {
  return new Promise((resolve, reject) => {
    const redirectUri = `${origin}/oauth-callback`;

    const postData = new URLSearchParams({
      code: code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }).toString();

    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(body));
        } else {
          logger.error(`Token 交换失败: ${body}`);
          reject(new Error(`Token 交换失败: ${res.statusCode} - ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// 直接添加 Token
export async function addDirectToken(tokenData) {
  try {
    const { access_token, refresh_token, expires_in } = tokenData;

    // 验证必填字段
    if (!access_token) {
      throw new Error('access_token 是必填项');
    }

    logger.info('正在添加直接输入的 Token...');

    // 加载现有账号
    const accounts = await loadAccounts();

    // 检查是否已存在相同的 access_token
    const exists = accounts.some(acc => acc.access_token === access_token);
    if (exists) {
      logger.warn('Token 已存在，跳过添加');
      return {
        success: false,
        error: '该 Token 已存在于账号列表中'
      };
    }

    // 创建新账号
    const newAccount = {
      access_token,
      refresh_token: refresh_token || null,
      expires_in: expires_in || 3600,
      timestamp: Date.now(),
      enable: true
    };

    // 添加到账号列表
    accounts.push(newAccount);

    // 保存账号
    await saveAccounts(accounts);

    logger.info('Token 添加成功');
    return {
      success: true,
      message: 'Token 添加成功',
      index: accounts.length - 1
    };
  } catch (error) {
    logger.error('添加 Token 失败:', error);
    throw error;
  }
}

// 批量导入 Token
export async function importTokens(filePath) {
  try {
    logger.info('开始导入 Token...');

    // 检查是否是 ZIP 文件
    if (filePath.endsWith('.zip') || true) {
      const zip = new AdmZip(filePath);
      const zipEntries = zip.getEntries();

      // 查找 tokens.json
      const tokensEntry = zipEntries.find(entry => entry.entryName === 'tokens.json');
      if (!tokensEntry) {
        throw new Error('ZIP 文件中没有找到 tokens.json');
      }

      const tokensContent = tokensEntry.getData().toString('utf8');
      const importedTokens = JSON.parse(tokensContent);

      // 验证数据格式
      if (!Array.isArray(importedTokens)) {
        throw new Error('tokens.json 格式错误：应该是一个数组');
      }

      // 加载现有账号
      const accounts = await loadAccounts();

      // 添加新账号
      let addedCount = 0;
      for (const token of importedTokens) {
        // 检查是否已存在
        const exists = accounts.some(acc => acc.access_token === token.access_token);
        if (!exists) {
          accounts.push({
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_in: token.expires_in,
            timestamp: token.timestamp || Date.now(),
            enable: token.enable !== false
          });
          addedCount++;
        }
      }

      // 保存账号
      await saveAccounts(accounts);
      tokenManager.forceReload(); // 强制刷新token管理器

      // 清理上传的文件
      try {
        await fs.unlink(filePath);
      } catch (e) {
        logger.warn('清理上传文件失败:', e);
      }

      logger.info(`成功导入 ${addedCount} 个 Token 账号，token管理器已刷新`);
      return {
        success: true,
        count: addedCount,
        total: importedTokens.length,
        skipped: importedTokens.length - addedCount,
        message: `成功导入 ${addedCount} 个 Token 账号${importedTokens.length - addedCount > 0 ? `，跳过 ${importedTokens.length - addedCount} 个重复账号` : ''}`
      };
    }
  } catch (error) {
    logger.error('导入 Token 失败:', error);
    // 清理上传的文件
    try {
      await fs.unlink(filePath);
    } catch (e) {}
    throw error;
  }
}
