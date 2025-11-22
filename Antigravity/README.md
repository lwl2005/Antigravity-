# Antigravity to OpenAI API 代理服务

将 Google Antigravity API 转换为 OpenAI 兼容格式的代理服务，支持流式响应、工具调用、多账号管理和完整的用户管理系统。

测试地址
https://ggt333.zeabur.app/user.html

## ✨ 核心功能

### API 代理
- ✅ OpenAI API 完全兼容格式
- ✅ 流式和非流式响应
- ✅ 工具调用（Function Calling）支持
- ✅ 多账号自动轮换
- ✅ Token 自动刷新
- ✅ API Key 认证
- ✅ 思维链（Thinking）输出
- ✅ 图片输入支持（Base64 编码）

### 管理系统
- 🎛️ **Web管理后台** - 完整的可视化管理界面
- 👥 **用户系统** - 用户注册、登录、API密钥管理
- 🔑 **密钥管理** - API密钥生成、频率限制
- 📢 **公告系统** - 系统公告发布和管理
- 📊 **模型配额** - 每日模型使用限制
- 🔐 **安全防护** - IP/设备封禁、注册限制

### 共享系统
- 🌐 **Token共享中心** - 用户可共享自己的Token供社区使用
- 🚫 **滥用防护** - 自动检测和封禁滥用用户
- 🗳️ **社区投票** - 社区投票封禁滥用者
- 📈 **使用统计** - 实时显示每个用户的使用情况
- ⚫ **黑名单系统** - Token所有者可屏蔽特定用户

### 🤖 AI自动管理
- 🔍 **智能分析** - AI自动分析用户使用模式
- ⚡ **自动封禁** - 基于AI判断自动封禁异常用户
- ⏱️ **定时任务** - 可配置每小时自动审核
- 📊 **详细日志** - 完整的审核历史和决策记录
- 🎯 **置信度控制** - 可调整自动封禁阈值

## 环境要求

- Node.js >= 18.0.0
- pnpm 或 npm

## 快速开始

### 1. 安装依赖

```bash
pnpm install
# 或
npm install
```

### 2. 配置文件

编辑 `config.json` 配置服务器和 API 参数：

```json
{
  "server": {
    "port": 8045,
    "host": "0.0.0.0"
  },
  "security": {
    "apiKey": "sk-text",
    "adminPassword": "admin123",
    "maxRequestSize": "50mb"
  },
  "defaults": {
    "temperature": 1,
    "top_p": 0.85,
    "top_k": 50,
    "max_tokens": 8096
  }
}
```

### 3. 启动服务

```bash
pnpm dev
# 或
npm run dev
```

服务将在 `http://localhost:8045` 启动。

### 4. 访问管理后台

打开浏览器访问 `http://localhost:8045`，使用配置的管理员密码登录。

## 📖 完整功能指南

### 管理后台功能

#### 1. Token 管理
- 添加/删除 Google Token
- 查看 Token 使用统计
- 启用/禁用 Token
- 导入/导出 Token

#### 2. 密钥管理
- 生成管理员 API 密钥
- 设置密钥频率限制（每分钟/每小时/每天）
- 查看密钥使用统计

#### 3. 用户管理
- 查看所有注册用户
- 启用/禁用用户
- 查看用户Token和使用情况
- 设置用户模型配额
- 查看用户共享统计

#### 4. 公告管理
- 创建/编辑/删除公告
- 设置公告优先级
- 启用/禁用公告

#### 5. 模型管理
- 从Google获取最新模型列表
- 设置默认模型配额
- 查看每个模型的使用统计

#### 6. 系统监控
- 实时请求统计
- 系统资源使用
- Token使用情况
- 错误日志查看

### 用户中心功能

访问 `http://localhost:8045/user.html` 进入用户中心：

- **账号注册/登录** - 独立的用户系统
- **API密钥管理** - 生成个人API密钥
- **Token管理** - 添加/共享自己的Google Token
- **使用统计** - 查看个人使用情况
- **模型配额** - 查看每日模型使用限额

### Token共享中心

访问 `http://localhost:8045/share.html` 进入共享中心：

- **Token列表** - 查看所有共享的Token及可用额度
- **用户统计** - 查看所有用户的使用排行
  - 平均日使用量
  - 今日使用量
  - 最大日使用量
  - 使用天数统计
  - 异常用户标识
- **投票封禁** - 发起或参与封禁投票
- **投票历史** - 查看所有投票记录

### AI自动管理系统

在管理后台的"AI 管理"标签页配置：

#### 配置项
- **启用AI审核** - 开启/关闭自动审核
- **API端点** - AI服务的API地址
- **API密钥** - AI服务的认证密钥
- **模型** - 使用的AI模型（如 gemini-2.0-flash-exp）
- **检查间隔** - 审核频率（1-24小时）
- **置信度阈值** - 自动封禁的最低置信度（0-1）
- **系统提示词** - AI分析的指导规则

#### AI审核规则
系统默认分析以下指标：
1. **使用频率** - 平均每天超过50次为异常
2. **使用模式** - 短时间内大量请求
3. **时间分布** - 24小时持续高频使用
4. **突增行为** - 使用量突然大幅增加

#### 操作功能
- **立即运行审核** - 手动触发一次审核
- **查看审核日志** - 显示最新50条审核记录
- **统计信息** - 总审核次数、封禁数、标记数

## API 使用

### 获取模型列表

```bash
curl http://localhost:8045/v1/models \
  -H "Authorization: Bearer sk-text"
```

### 聊天补全（流式）

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-text" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

### 工具调用示例

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-text" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "北京天气怎么样"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "获取天气信息",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string", "description": "城市名称"}
          }
        }
      }
    }]
  }'
```

### 图片输入示例

```bash
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-text" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "这张图片里有什么？"},
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
          }
        }
      ]
    }],
    "stream": true
  }'
```

支持的图片格式：JPEG、PNG、GIF、WebP

## 项目结构

```
.
├── data/                      # 数据目录（自动生成）
│   ├── accounts.json         # Token 存储
│   ├── users.json            # 用户数据
│   ├── share_data.json       # 共享系统数据
│   ├── ai_config.json        # AI配置
│   └── ai_moderation_logs.json # AI审核日志
├── public/                    # 前端页面
│   ├── index.html            # 管理后台
│   ├── user.html             # 用户中心
│   └── share.html            # 共享中心
├── scripts/
│   └── oauth-server.js       # OAuth 登录服务
├── src/
│   ├── admin/                # 管理模块
│   │   ├── routes.js         # 管理路由
│   │   ├── user_manager.js   # 用户管理
│   │   ├── share_manager.js  # 共享管理
│   │   ├── ai_moderator.js   # AI自动管理
│   │   ├── key_manager.js    # 密钥管理
│   │   ├── model_manager.js  # 模型管理
│   │   └── ...               # 其他管理模块
│   ├── api/
│   │   └── client.js         # API 调用逻辑
│   ├── auth/
│   │   └── token_manager.js  # Token 管理
│   ├── config/
│   │   └── config.js         # 配置加载
│   ├── server/
│   │   └── index.js          # 主服务器
│   └── utils/
│       ├── logger.js         # 日志模块
│       └── utils.js          # 工具函数
├── config.json               # 配置文件
└── package.json              # 项目配置
```

## 安全特性

### 用户安全
- 密码加密存储（PBKDF2）
- 会话Token管理
- API密钥认证
- 频率限制保护

### 防滥用机制
- IP注册限制（每IP每天最多注册数）
- 设备注册限制（基于指纹识别）
- 自动清理长期未登录账号
- 共享使用量监控

### AI自动防护
- 智能检测异常使用模式
- 自动封禁滥用账号
- 渐进式封禁时长（1天→3天→7天→14天→30天→90天）
- 社区投票机制

## 配置说明

### config.json 完整配置

```json
{
  "server": {
    "port": 8045,
    "host": "0.0.0.0"
  },
  "security": {
    "apiKey": "sk-text",
    "adminPassword": "admin123",
    "maxRequestSize": "50mb"
  },
  "defaults": {
    "temperature": 1,
    "top_p": 0.85,
    "top_k": 50,
    "max_tokens": 8096
  },
  "systemInstruction": "你是一个有帮助的AI助手"
}
```

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `server.port` | 服务端口 | 8045 |
| `server.host` | 监听地址 | 0.0.0.0 |
| `security.apiKey` | 管理员API密钥 | sk-text |
| `security.adminPassword` | 管理后台密码 | admin123 |
| `security.maxRequestSize` | 最大请求体大小 | 50mb |
| `defaults.temperature` | 默认温度参数 | 1 |
| `defaults.top_p` | 默认 top_p | 0.85 |
| `defaults.top_k` | 默认 top_k | 50 |
| `defaults.max_tokens` | 默认最大token数 | 8096 |
| `systemInstruction` | 系统提示词 | - |

## 开发命令

```bash
# 启动服务
npm start

# 开发模式（自动重启）
npm run dev

# 登录获取 Token
npm run login
```

## 常见问题

### 1. 如何获取Google Token？

运行 `npm run login` 启动OAuth服务器，在浏览器中完成Google登录。

### 2. 如何配置AI自动管理？

1. 访问管理后台的"AI 管理"标签
2. 配置API端点（如本地服务地址）
3. 设置API密钥
4. 调整置信度阈值和检查间隔
5. 启用AI审核

### 3. 用户如何共享Token？

1. 用户登录用户中心
2. 在"我的Token"中添加Google Token
3. 勾选"共享此Token"
4. Token会出现在共享中心供其他用户使用

### 4. 如何处理滥用用户？

系统提供三种方式：
- **自动封禁** - AI检测到异常自动封禁
- **手动封禁** - 在用户管理中手动操作
- **投票封禁** - 社区投票决定是否封禁

### 5. 封禁时长规则是什么？

采用渐进式封禁：
- 第1次：1天
- 第2次：3天
- 第3次：7天
- 第4次：14天
- 第5次：30天
- 第6次及以后：90天

## 注意事项

1. 首次使用需要运行 `npm run login` 获取 Token
2. `data/` 目录包含敏感信息，请勿泄露
3. 建议修改默认的管理员密码
4. AI自动管理需要配置有效的AI服务端点
5. 共享Token的用户需自行承担配额使用
6. 定期查看AI审核日志，确保系统正常运行

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 更新日志

### v2.0.0
- ✨ 新增完整的Web管理后台
- ✨ 新增用户系统和用户中心
- ✨ 新增Token共享系统
- ✨ 新增AI自动管理功能
- ✨ 新增社区投票封禁机制
- ✨ 新增用户使用统计展示
- 🔧 优化Token轮换机制
- 🔧 完善安全防护措施

### v1.0.0
- 🎉 初始版本发布
- ✅ OpenAI API兼容
- ✅ 流式响应支持
- ✅ 工具调用支持
