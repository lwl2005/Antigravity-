# 管理员初始化功能说明

## 🎯 功能概述

从本版本开始，系统采用了**安全的初始化流程**，不再使用配置文件中的默认管理员密码。首次访问管理面板时，您需要创建管理员账号。

## ✨ 新特性

- ✅ **首次访问初始化** - 系统第一次启动时，自动进入初始化设置
- ✅ **管理员数据库存储** - 管理员信息存储在数据库中，更安全
- ✅ **多管理员支持** - 支持创建多个管理员账号
- ✅ **密码强度要求** - 密码最少8个字符，确保安全性
- ✅ **无默认密码** - 不再有默认密码，避免安全隐患

## 🚀 使用流程

### 首次使用

1. **访问管理面板**
   ```
   http://your-server:8045/admin.html
   ```

2. **系统初始化界面**

   首次访问时，会看到欢迎界面，需要设置管理员账号：

   - **用户名**: 3-20个字符，只能包含字母、数字和下划线
   - **密码**: 至少8个字符
   - **确认密码**: 再次输入密码确认

3. **创建账号**

   点击"创建管理员账号"按钮，系统会：
   - 验证输入信息
   - 创建管理员账号
   - 自动登录进入管理面板

### 后续登录

初始化完成后，后续登录需要：

1. 输入管理员用户名
2. 输入密码
3. 点击登录

## 🔧 管理功能

### 创建新管理员

在管理面板中（功能待实现），您可以：

1. 进入"管理员管理"页面
2. 点击"添加管理员"
3. 输入新管理员的用户名和密码
4. 保存

### 修改密码

管理员可以修改自己的密码：

1. 进入"设置"或"个人信息"
2. 点击"修改密码"
3. 输入旧密码和新密码
4. 确认修改

### 删除管理员

您可以删除其他管理员账号：

- ⚠️ 注意：无法删除最后一个管理员账号
- 删除操作不可恢复，请谨慎操作

## 🔐 安全建议

1. **强密码** - 使用包含大小写字母、数字和特殊字符的强密码
2. **定期更换** - 定期更换管理员密码
3. **限制访问** - 使用防火墙限制管理面板的访问IP
4. **HTTPS** - 生产环境建议使用HTTPS
5. **备份** - 定期备份数据库文件

## 📊 数据库存储

管理员信息存储在数据库中：

### admins 表结构

```sql
CREATE TABLE admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,  -- PBKDF2哈希存储
    created_at INTEGER NOT NULL,
    last_login INTEGER
);
```

### system_settings 表

```sql
CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
```

系统使用 `initialized` 键来标记是否已完成初始化。

## 🔄 API端点

### 检查初始化状态

```bash
GET /admin/system/status

Response:
{
    "initialized": true
}
```

### 初始化系统

```bash
POST /admin/system/initialize
Content-Type: application/json

{
    "username": "admin",
    "password": "your-secure-password"
}

Response:
{
    "success": true,
    "username": "admin"
}
```

### 管理员登录

```bash
POST /admin/admin/login
Content-Type: application/json

{
    "username": "admin",
    "password": "your-password"
}

Response:
{
    "success": true,
    "username": "admin",
    "token": "session-token-here"
}
```

### 修改密码

```bash
POST /admin/admin/change-password
X-Admin-Token: your-session-token
Content-Type: application/json

{
    "username": "admin",
    "oldPassword": "old-password",
    "newPassword": "new-password"
}

Response:
{
    "success": true,
    "message": "密码修改成功"
}
```

### 创建新管理员

```bash
POST /admin/admin/create
X-Admin-Token: your-session-token
Content-Type: application/json

{
    "username": "newadmin",
    "password": "secure-password"
}

Response:
{
    "success": true,
    "username": "newadmin"
}
```

### 删除管理员

```bash
DELETE /admin/admin/:username
X-Admin-Token: your-session-token

Response:
{
    "success": true,
    "message": "管理员删除成功"
}
```

### 获取管理员列表

```bash
GET /admin/admin/list
X-Admin-Token: your-session-token

Response:
{
    "admins": [
        {
            "id": 1,
            "username": "admin",
            "createdAt": 1234567890000,
            "lastLogin": 1234567890000
        }
    ]
}
```

## 🛠️ 故障排查

### 忘记密码怎么办？

如果忘记了所有管理员密码，可以通过以下方式重置：

#### 方法1: 删除数据库重新初始化

```bash
# 停止服务
docker stop antigravity  # 如果使用Docker

# 备份数据库
cp data/antigravity.db data/antigravity.db.backup

# 删除数据库
rm data/antigravity.db

# 重启服务
docker start antigravity  # 如果使用Docker
npm start  # 如果直接运行
```

⚠️ **注意**: 这会删除所有数据，包括用户、API密钥、使用记录等！

#### 方法2: 直接操作数据库

```bash
# 使用SQLite命令行
sqlite3 data/antigravity.db

# 重置初始化状态
DELETE FROM system_settings WHERE key = 'initialized';
DELETE FROM admins;

# 退出
.quit
```

然后重启服务，系统会重新进入初始化状态。

### 系统一直显示初始化界面

检查数据库中的初始化状态：

```bash
sqlite3 data/antigravity.db "SELECT * FROM system_settings WHERE key = 'initialized';"
```

如果没有记录或值不是 'true'，说明初始化未成功完成。

### 无法登录

1. **检查用户名和密码** - 确保输入正确
2. **检查数据库** - 确认admins表中有记录
3. **查看日志** - 检查应用日志中的错误信息
4. **清除浏览器缓存** - 清除localStorage和cookies

## 🔄 从旧版本迁移

如果您从旧版本（使用config.json中的adminPassword）升级：

1. **自动迁移** - 首次访问时会自动进入初始化流程
2. **数据保留** - 用户数据、Token、API密钥等都会保留
3. **重新设置** - 您需要重新创建管理员账号

⚠️ **重要**: 旧的 `config.json` 中的 `adminPassword` 字段已被移除，不再使用。

## 📝 更新日志

### v1.2.0 - 管理员初始化功能

- ✨ 新增首次访问初始化流程
- ✨ 管理员信息存储到数据库
- ✨ 支持多管理员账号
- ✨ 增强密码安全性（PBKDF2哈希）
- 🔒 移除配置文件中的默认密码
- 📝 完善管理员管理API

---

## 💡 最佳实践

1. **初始密码设置**
   - 使用随机生成的强密码
   - 记录在安全的地方（密码管理器）

2. **管理员账号管理**
   - 为每个管理员创建独立账号
   - 定期审查管理员列表
   - 及时删除离职人员的账号

3. **安全加固**
   - 使用HTTPS（通过Nginx反向代理）
   - 限制管理面板访问IP（防火墙规则）
   - 定期备份数据库
   - 启用访问日志审计

4. **监控和审计**
   - 定期检查管理员登录日志
   - 监控异常登录尝试
   - 设置登录失败告警

---

## 📞 技术支持

如有问题或建议，请：

1. 查看应用日志: `docker logs -f antigravity`
2. 检查数据库状态
3. 提交Issue到GitHub仓库

---

## 📄 相关文档

- [DATABASE_README.md](./DATABASE_README.md) - 数据库和Docker部署说明
- [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) - 数据迁移指南
- [README.md](./README.md) - 项目主文档
