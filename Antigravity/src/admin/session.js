import crypto from 'crypto';
import config from '../config/config.js';

// 存储有效的会话 token
const sessions = new Map();

// 会话过期时间（24小时）
const SESSION_EXPIRY = 24 * 60 * 60 * 1000;

// 生成会话 token
export function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    created: Date.now(),
    lastAccess: Date.now()
  });
  return token;
}

// 验证会话
export function validateSession(token) {
  if (!token) return false;

  const session = sessions.get(token);
  if (!session) return false;

  // 检查是否过期
  if (Date.now() - session.created > SESSION_EXPIRY) {
    sessions.delete(token);
    return false;
  }

  // 更新最后访问时间
  session.lastAccess = Date.now();
  return true;
}

// 删除会话
export function destroySession(token) {
  sessions.delete(token);
}

// 验证密码
export function verifyPassword(password) {
  const adminPassword = config.security?.adminPassword || 'admin123';
  return password === adminPassword;
}

// 获取管理密码
export function getAdminPassword() {
  return config.security?.adminPassword || 'admin123';
}

// 清理过期会话
function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now - session.created > SESSION_EXPIRY) {
      sessions.delete(token);
    }
  }
}

// 每小时清理一次过期会话
setInterval(cleanupSessions, 60 * 60 * 1000);

// 管理员认证中间件
export function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.headers['x-admin-session'] || req.query.token;

  if (validateSession(token)) {
    next();
  } else {
    res.status(401).json({ error: '未授权，请先登录' });
  }
}
