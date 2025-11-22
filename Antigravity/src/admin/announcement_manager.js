import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import logger from '../utils/logger.js';

const ANNOUNCEMENTS_FILE = path.join(process.cwd(), 'data', 'announcements.json');

// 读取所有公告
export async function loadAnnouncements() {
  try {
    const data = await fs.readFile(ANNOUNCEMENTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// 保存公告
async function saveAnnouncements(announcements) {
  const dir = path.dirname(ANNOUNCEMENTS_FILE);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(ANNOUNCEMENTS_FILE, JSON.stringify(announcements, null, 2), 'utf-8');
}

// 创建公告
export async function createAnnouncement(data) {
  const announcements = await loadAnnouncements();

  const newAnnouncement = {
    id: crypto.randomBytes(8).toString('hex'),
    title: data.title,
    content: data.content,
    type: data.type || 'info', // info, success, warning, danger
    images: data.images || [],
    pinned: data.pinned || false,
    created: Date.now(),
    updated: Date.now(),
    enabled: true
  };

  announcements.unshift(newAnnouncement);
  await saveAnnouncements(announcements);

  logger.info(`创建新公告: ${data.title}`);

  return newAnnouncement;
}

// 更新公告
export async function updateAnnouncement(id, data) {
  const announcements = await loadAnnouncements();
  const announcement = announcements.find(a => a.id === id);

  if (!announcement) {
    throw new Error('公告不存在');
  }

  if (data.title !== undefined) announcement.title = data.title;
  if (data.content !== undefined) announcement.content = data.content;
  if (data.type !== undefined) announcement.type = data.type;
  if (data.images !== undefined) announcement.images = data.images;
  if (data.pinned !== undefined) announcement.pinned = data.pinned;
  if (data.enabled !== undefined) announcement.enabled = data.enabled;

  announcement.updated = Date.now();

  await saveAnnouncements(announcements);

  logger.info(`更新公告: ${announcement.title}`);

  return announcement;
}

// 删除公告
export async function deleteAnnouncement(id) {
  const announcements = await loadAnnouncements();
  const index = announcements.findIndex(a => a.id === id);

  if (index === -1) {
    throw new Error('公告不存在');
  }

  const deleted = announcements.splice(index, 1)[0];
  await saveAnnouncements(announcements);

  logger.info(`删除公告: ${deleted.title}`);

  return true;
}

// 获取所有启用的公告（用户端）
export async function getActiveAnnouncements() {
  const announcements = await loadAnnouncements();

  // 只返回启用的公告，置顶的排在前面
  return announcements
    .filter(a => a.enabled)
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.created - a.created;
    });
}

// 获取单个公告
export async function getAnnouncementById(id) {
  const announcements = await loadAnnouncements();
  return announcements.find(a => a.id === id);
}
