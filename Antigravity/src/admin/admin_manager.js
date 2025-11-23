import crypto from 'crypto';
import db from '../database/db.js';
import logger from '../utils/logger.js';

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

// 生成会话Token
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 检查系统是否已初始化
export function isSystemInitialized() {
  try {
    const stmt = db.prepare('SELECT value FROM system_settings WHERE key = ?');
    const result = stmt.get('initialized');
    return result && result.value === 'true';
  } catch (error) {
    logger.error('检查系统初始化状态失败:', error.message);
    return false;
  }
}

// 初始化系统（创建第一个管理员）
export function initializeSystem(username, password) {
  try {
    // 检查是否已经初始化
    if (isSystemInitialized()) {
      throw new Error('系统已经初始化');
    }

    // 验证用户名格式
    if (!username || username.length < 3 || username.length > 20) {
      throw new Error('用户名长度必须在3-20个字符之间');
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      throw new Error('用户名只能包含字母、数字和下划线');
    }

    // 验证密码强度
    if (!password || password.length < 8) {
      throw new Error('密码长度至少8个字符');
    }

    const now = Date.now();

    // 使用事务确保原子性
    const transaction = db.transaction(() => {
      // 创建管理员账号
      const insertAdmin = db.prepare(`
        INSERT INTO admins (username, password, created_at)
        VALUES (?, ?, ?)
      `);
      insertAdmin.run(username, hashPassword(password), now);

      // 标记系统已初始化
      const insertSetting = db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, ?)
      `);
      insertSetting.run('initialized', 'true', now);
    });

    transaction();

    logger.info(`系统初始化完成，管理员账号: ${username}`);

    return {
      success: true,
      username
    };
  } catch (error) {
    logger.error('系统初始化失败:', error.message);
    throw error;
  }
}

// 管理员登录
export function adminLogin(username, password) {
  try {
    // 检查系统是否已初始化
    if (!isSystemInitialized()) {
      throw new Error('系统未初始化，请先完成初始化设置');
    }

    // 查找管理员
    const stmt = db.prepare('SELECT * FROM admins WHERE username = ?');
    const admin = stmt.get(username);

    if (!admin) {
      throw new Error('用户名或密码错误');
    }

    // 验证密码
    if (!verifyPassword(password, admin.password)) {
      throw new Error('用户名或密码错误');
    }

    // 更新最后登录时间
    const updateStmt = db.prepare('UPDATE admins SET last_login = ? WHERE id = ?');
    updateStmt.run(Date.now(), admin.id);

    // 生成会话Token
    const sessionToken = generateSessionToken();

    logger.info(`管理员登录: ${username}`);

    return {
      success: true,
      username: admin.username,
      token: sessionToken
    };
  } catch (error) {
    logger.error('管理员登录失败:', error.message);
    throw error;
  }
}

// 修改管理员密码
export function changeAdminPassword(username, oldPassword, newPassword) {
  try {
    // 查找管理员
    const stmt = db.prepare('SELECT * FROM admins WHERE username = ?');
    const admin = stmt.get(username);

    if (!admin) {
      throw new Error('管理员不存在');
    }

    // 验证旧密码
    if (!verifyPassword(oldPassword, admin.password)) {
      throw new Error('原密码错误');
    }

    // 验证新密码
    if (!newPassword || newPassword.length < 8) {
      throw new Error('新密码长度至少8个字符');
    }

    // 更新密码
    const updateStmt = db.prepare('UPDATE admins SET password = ? WHERE id = ?');
    updateStmt.run(hashPassword(newPassword), admin.id);

    logger.info(`管理员 ${username} 修改了密码`);

    return {
      success: true,
      message: '密码修改成功'
    };
  } catch (error) {
    logger.error('修改密码失败:', error.message);
    throw error;
  }
}

// 获取管理员信息
export function getAdminInfo(username) {
  try {
    const stmt = db.prepare('SELECT id, username, created_at, last_login FROM admins WHERE username = ?');
    const admin = stmt.get(username);

    if (!admin) {
      throw new Error('管理员不存在');
    }

    return {
      id: admin.id,
      username: admin.username,
      createdAt: admin.created_at,
      lastLogin: admin.last_login
    };
  } catch (error) {
    logger.error('获取管理员信息失败:', error.message);
    throw error;
  }
}

// 获取所有管理员列表（仅用于显示）
export function getAllAdmins() {
  try {
    const stmt = db.prepare('SELECT id, username, created_at, last_login FROM admins ORDER BY created_at ASC');
    const admins = stmt.all();

    return admins.map(admin => ({
      id: admin.id,
      username: admin.username,
      createdAt: admin.created_at,
      lastLogin: admin.last_login
    }));
  } catch (error) {
    logger.error('获取管理员列表失败:', error.message);
    throw error;
  }
}

// 创建新管理员（需要已有管理员权限）
export function createAdmin(username, password) {
  try {
    // 验证系统已初始化
    if (!isSystemInitialized()) {
      throw new Error('系统未初始化');
    }

    // 验证用户名格式
    if (!username || username.length < 3 || username.length > 20) {
      throw new Error('用户名长度必须在3-20个字符之间');
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      throw new Error('用户名只能包含字母、数字和下划线');
    }

    // 验证密码强度
    if (!password || password.length < 8) {
      throw new Error('密码长度至少8个字符');
    }

    // 检查用户名是否已存在
    const checkStmt = db.prepare('SELECT id FROM admins WHERE username = ?');
    if (checkStmt.get(username)) {
      throw new Error('用户名已存在');
    }

    // 创建管理员
    const insertStmt = db.prepare(`
      INSERT INTO admins (username, password, created_at)
      VALUES (?, ?, ?)
    `);
    insertStmt.run(username, hashPassword(password), Date.now());

    logger.info(`创建新管理员: ${username}`);

    return {
      success: true,
      username
    };
  } catch (error) {
    logger.error('创建管理员失败:', error.message);
    throw error;
  }
}

// 删除管理员
export function deleteAdmin(username) {
  try {
    // 检查是否是最后一个管理员
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM admins');
    const count = countStmt.get().count;

    if (count <= 1) {
      throw new Error('无法删除最后一个管理员账号');
    }

    // 删除管理员
    const deleteStmt = db.prepare('DELETE FROM admins WHERE username = ?');
    const result = deleteStmt.run(username);

    if (result.changes === 0) {
      throw new Error('管理员不存在');
    }

    logger.info(`删除管理员: ${username}`);

    return {
      success: true,
      message: '管理员删除成功'
    };
  } catch (error) {
    logger.error('删除管理员失败:', error.message);
    throw error;
  }
}
