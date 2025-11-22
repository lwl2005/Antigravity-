import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import logger from '../utils/logger.js';

const SECURITY_FILE = path.join(process.cwd(), 'data', 'security.json');

// 加载安全数据
async function loadSecurityData() {
  try {
    const data = await fs.readFile(SECURITY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        ipRegistrations: {},  // IP -> [{timestamp, userId}]
        deviceRegistrations: {}, // deviceId -> [{timestamp, userId}]
        bannedIPs: {}, // IP -> {reason, bannedAt}
        bannedDevices: {}, // deviceId -> {reason, bannedAt}
        suspiciousAttempts: {} // IP -> count
      };
    }
    throw error;
  }
}

// 保存安全数据
async function saveSecurityData(data) {
  const dir = path.dirname(SECURITY_FILE);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(SECURITY_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// 生成设备指纹
export function generateDeviceFingerprint(userAgent, acceptLanguage, screenResolution, timezone, platform) {
  const data = `${userAgent}|${acceptLanguage}|${screenResolution}|${timezone}|${platform}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

// 检查IP是否被封禁
export async function isIPBanned(ip) {
  const security = await loadSecurityData();
  return !!security.bannedIPs[ip];
}

// 检查设备是否被封禁
export async function isDeviceBanned(deviceId) {
  const security = await loadSecurityData();
  return !!security.bannedDevices[deviceId];
}

// 检查IP注册限制
export async function checkIPRegistrationLimit(ip) {
  const security = await loadSecurityData();

  // 检查是否被封禁
  if (security.bannedIPs[ip]) {
    throw new Error(`该 IP 已被封禁：${security.bannedIPs[ip].reason}`);
  }

  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  // 获取24小时内的注册记录
  if (!security.ipRegistrations[ip]) {
    security.ipRegistrations[ip] = [];
  }

  // 清理过期记录
  security.ipRegistrations[ip] = security.ipRegistrations[ip].filter(
    record => record.timestamp > dayAgo
  );

  // 检查注册数量
  if (security.ipRegistrations[ip].length >= 5) {
    // 记录可疑尝试
    if (!security.suspiciousAttempts[ip]) {
      security.suspiciousAttempts[ip] = 0;
    }
    security.suspiciousAttempts[ip]++;

    // 如果尝试次数超过3次，封禁IP
    if (security.suspiciousAttempts[ip] >= 3) {
      security.bannedIPs[ip] = {
        reason: '短时间内注册次数过多（超过限制3次以上）',
        bannedAt: now
      };
      await saveSecurityData(security);
      logger.warn(`IP ${ip} 已被封禁：注册尝试次数过多`);
      throw new Error('该 IP 已被封禁：注册次数过多');
    }

    await saveSecurityData(security);
    throw new Error('24小时内该 IP 已注册5个账号，请稍后再试');
  }

  return true;
}

// 检查设备注册限制
export async function checkDeviceRegistrationLimit(deviceId) {
  const security = await loadSecurityData();

  // 检查是否被封禁
  if (security.bannedDevices[deviceId]) {
    throw new Error(`该设备已被封禁：${security.bannedDevices[deviceId].reason}`);
  }

  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  // 获取24小时内的注册记录
  if (!security.deviceRegistrations[deviceId]) {
    security.deviceRegistrations[deviceId] = [];
  }

  // 清理过期记录
  security.deviceRegistrations[deviceId] = security.deviceRegistrations[deviceId].filter(
    record => record.timestamp > dayAgo
  );

  // 检查注册数量
  if (security.deviceRegistrations[deviceId].length >= 5) {
    // 封禁设备
    security.bannedDevices[deviceId] = {
      reason: '短时间内同一设备注册次数过多',
      bannedAt: now
    };
    await saveSecurityData(security);
    logger.warn(`设备 ${deviceId} 已被封禁：注册尝试次数过多`);
    throw new Error('该设备已被封禁：注册次数过多');
  }

  return true;
}

// 记录注册
export async function recordRegistration(ip, deviceId, userId) {
  const security = await loadSecurityData();
  const now = Date.now();

  // 记录IP注册
  if (!security.ipRegistrations[ip]) {
    security.ipRegistrations[ip] = [];
  }
  security.ipRegistrations[ip].push({ timestamp: now, userId });

  // 记录设备注册
  if (deviceId) {
    if (!security.deviceRegistrations[deviceId]) {
      security.deviceRegistrations[deviceId] = [];
    }
    security.deviceRegistrations[deviceId].push({ timestamp: now, userId });
  }

  await saveSecurityData(security);
  logger.info(`记录注册：IP=${ip}, 设备=${deviceId}, 用户=${userId}`);
}

// 清理长时间未登录的账号（超过15天）
export async function cleanupInactiveUsers(users) {
  const now = Date.now();
  const inactivePeriod = 15 * 24 * 60 * 60 * 1000; // 15天
  const deletedUsers = [];

  const activeUsers = users.filter(user => {
    const lastActivity = user.lastLogin || user.created;
    const inactive = now - lastActivity > inactivePeriod;

    if (inactive) {
      deletedUsers.push({
        username: user.username,
        lastActivity: new Date(lastActivity).toLocaleString()
      });
      return false;
    }
    return true;
  });

  if (deletedUsers.length > 0) {
    logger.info(`自动清理 ${deletedUsers.length} 个长时间未登录账号：${deletedUsers.map(u => u.username).join(', ')}`);
  }

  return { users: activeUsers, deletedCount: deletedUsers.length, deletedUsers };
}

// 获取安全统计
export async function getSecurityStats() {
  const security = await loadSecurityData();

  return {
    bannedIPsCount: Object.keys(security.bannedIPs).length,
    bannedDevicesCount: Object.keys(security.bannedDevices).length,
    bannedIPs: security.bannedIPs,
    bannedDevices: security.bannedDevices
  };
}

// 解封IP
export async function unbanIP(ip) {
  const security = await loadSecurityData();

  if (security.bannedIPs[ip]) {
    delete security.bannedIPs[ip];
    delete security.suspiciousAttempts[ip];
    await saveSecurityData(security);
    logger.info(`IP ${ip} 已解封`);
    return true;
  }

  return false;
}

// 解封设备
export async function unbanDevice(deviceId) {
  const security = await loadSecurityData();

  if (security.bannedDevices[deviceId]) {
    delete security.bannedDevices[deviceId];
    await saveSecurityData(security);
    logger.info(`设备 ${deviceId} 已解封`);
    return true;
  }

  return false;
}
