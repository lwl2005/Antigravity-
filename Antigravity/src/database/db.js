import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger.js';

const DB_PATH = path.join(process.cwd(), 'data', 'antigravity.db');

// 确保data目录存在
function ensureDataDir() {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// 创建数据库连接
function createDatabase() {
  ensureDataDir();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL'); // 启用WAL模式提高并发性能
  return db;
}

// 初始化数据库表结构
function initializeSchema(db) {
  // 系统设置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // 管理员表
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_login INTEGER
    );
  `);

  // 用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT UNIQUE,
      google_id TEXT,
      system_prompt TEXT,
      created INTEGER NOT NULL,
      last_login INTEGER,
      enabled INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  // 用户API密钥表
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created INTEGER NOT NULL,
      last_used INTEGER,
      requests INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_id ON user_api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_api_keys_key ON user_api_keys(key);
  `);

  // Google Token表
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_in INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      email TEXT,
      enabled INTEGER DEFAULT 1,
      is_shared INTEGER DEFAULT 0,
      daily_limit INTEGER DEFAULT 100,
      usage_today INTEGER DEFAULT 0,
      last_reset_date TEXT,
      proxy_id TEXT,
      disabled_until INTEGER,
      quota_exhausted INTEGER DEFAULT 0,
      total_cost REAL DEFAULT 0,
      daily_cost REAL DEFAULT 0,
      last_reset_time INTEGER DEFAULT 0,
      total_requests INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_google_tokens_user_id ON google_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_google_tokens_refresh_token ON google_tokens(refresh_token);
    CREATE INDEX IF NOT EXISTS idx_google_tokens_is_shared ON google_tokens(is_shared);
  `);

  // API密钥表（管理员创建的）
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created TEXT NOT NULL,
      last_used TEXT,
      requests INTEGER DEFAULT 0,
      rate_limit_enabled INTEGER DEFAULT 0,
      rate_limit_max_requests INTEGER DEFAULT 100,
      rate_limit_window_ms INTEGER DEFAULT 60000,
      balance REAL DEFAULT 0,
      max_balance REAL DEFAULT 10,
      total_spent REAL DEFAULT 0,
      is_unlimited INTEGER DEFAULT 0
    );
  `);

  // API密钥使用记录表（用于频率限制）
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_key_usage (
      key TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      count INTEGER DEFAULT 1,
      PRIMARY KEY (key, timestamp),
      FOREIGN KEY (key) REFERENCES api_keys(key) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_api_key_usage_timestamp ON api_key_usage(timestamp);
  `);

  // 使用日志表
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      key_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cost REAL NOT NULL,
      input_cost REAL NOT NULL,
      output_cost REAL NOT NULL,
      session_id TEXT,
      request_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_usage_logs_key_id ON usage_logs(key_id);
    CREATE INDEX IF NOT EXISTS idx_usage_logs_timestamp ON usage_logs(timestamp);
  `);

  // 应用日志表
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_app_logs_timestamp ON app_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level);
  `);

  // 模型表
  db.exec(`
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      quota INTEGER DEFAULT -1,
      enabled INTEGER DEFAULT 1
    );
  `);

  // 模型使用统计表
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_usage (
      model_id TEXT NOT NULL,
      date TEXT NOT NULL,
      usage INTEGER DEFAULT 0,
      PRIMARY KEY (model_id, date),
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
    );
  `);

  // 定价表
  db.exec(`
    CREATE TABLE IF NOT EXISTS pricing (
      model TEXT PRIMARY KEY,
      input_price REAL NOT NULL,
      output_price REAL NOT NULL
    );
  `);

  // 代理池表
  db.exec(`
    CREATE TABLE IF NOT EXISTS proxies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password TEXT,
      enabled INTEGER DEFAULT 1,
      created TEXT NOT NULL
    );
  `);

  // 安全表
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      identifier TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      data TEXT,
      expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_security_events_identifier ON security_events(identifier);
    CREATE INDEX IF NOT EXISTS idx_security_events_expires ON security_events(expires_at);
  `);

  // Token共享表
  db.exec(`
    CREATE TABLE IF NOT EXISTS share_bans (
      user_id TEXT PRIMARY KEY,
      ban_until INTEGER NOT NULL,
      reason TEXT,
      created INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS share_usage (
      user_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (user_id, timestamp)
    );
    CREATE INDEX IF NOT EXISTS idx_share_usage_timestamp ON share_usage(timestamp);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS share_votes (
      voter_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      token_index INTEGER NOT NULL,
      vote_type INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (voter_id, owner_id, token_index)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS share_blacklist (
      owner_id TEXT NOT NULL,
      token_index INTEGER NOT NULL,
      blocked_user_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (owner_id, token_index, blocked_user_id)
    );
  `);

  logger.info('数据库表结构初始化完成');
}

// 创建并初始化数据库
const db = createDatabase();
initializeSchema(db);

export default db;
