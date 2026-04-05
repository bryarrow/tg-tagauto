# GramJS Telegram 用户信息 Worker 示例

这个示例使用 TypeScript + `gramjs` 在 Cloudflare Worker 中读取 Telegram 用户账号信息，并把结果打印到 Worker 日志里。

## 使用方法

1. 安装依赖：

```bash
npm install
```

2. 复制环境变量模板并填写你自己的 Telegram API 信息：

```bash
copy .env.example .env
```

需要在 Telegram 官方开发者平台申请：

- `TG_API_ID`
- `TG_API_HASH`
- `TG_SESSION`（需要先在本地生成，再配置到 Worker Secret）

3. 本地生成 `TG_SESSION`：

```bash
npm run generate:session
```

登录成功后，脚本会在控制台打印一个 session 字符串，把它保存为 Cloudflare Worker 的 `TG_SESSION` Secret。

4. 本地检查 Worker 构建：

```bash
npm run build
npm run worker:check
```

5. 本地调试 Worker：

先用同一个模板生成 Worker 本地变量文件：

```bash
copy .env.example .dev.vars
```

然后填入：

- `TG_API_ID`
- `TG_API_HASH`
- `TG_SESSION`

```bash
npm run worker:dev
```

## Worker 环境变量

需要在 Cloudflare Worker 中配置这几个绑定或 Secret：

- `TG_API_ID`
- `TG_API_HASH`
- `TG_SESSION`

## 功能

Worker 每次收到请求时会连接 Telegram，并在控制台打印当前已登录用户的基本信息：

- `id`
- `firstName`
- `lastName`
- `username`
- `phone`
- `premium`
- `bot`

同时 HTTP 响应也会返回同样的 JSON，方便你本地验证。

## 限制

Cloudflare Worker 不能交互式输入手机号验证码，所以首次登录必须在本地执行 `npm run generate:session`，再把得到的 `TG_SESSION` 配到 Worker。
