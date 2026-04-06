# mtcute Telegram 用户昵称同步 Worker

这个示例使用 TypeScript + `mtcute` 在 Cloudflare Worker 中读取 Telegram 用户账号信息，并同步昵称里的数字到 Durable Object 计数器。

当前版本已从 `GramJS` 迁移到 `mtcute`。

Worker 端现在只接受 `mtcute` 原生 `TG_SESSION`。如果你手里还是旧的 `GramJS` session，可以先在本地执行一次 `npm run generate:session`，脚本会自动转换并把新的 `mtcute` session 写回 `.env`。

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
- `NAME_EXTRACT_REGEX`（用于从 `firstName + lastName` 中提取字符）
- `TG_GROUP_ID`（可选，用于在 `GET /` 时读取当前账号在这个群里的 member tag）

3. 本地生成 `TG_SESSION`：

```bash
npm run generate:session
```

登录成功后，脚本会打印一个 `mtcute` session 字符串，把它保存为 Cloudflare Worker 的 `TG_SESSION` Secret。

如果 `.env` 里已经放了旧的 `GramJS` session，脚本会先尝试导入旧 session，再导出新的 `mtcute` session，并直接更新 `.env` 里的 `TG_SESSION`。

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
- `NAME_EXTRACT_REGEX`

```bash
npm run worker:dev
```

## Worker 环境变量

需要在 Cloudflare Worker 中配置这几个绑定或 Secret：

- `TG_API_ID`
- `TG_API_HASH`
- `TG_SESSION`
- `NAME_EXTRACT_REGEX`
- `TG_GROUP_ID`（可选）
- `COUNTER`（Durable Object，已在 `wrangler.toml` 中声明）

## 功能

`GET /` 会读取 Telegram 当前昵称中的数字，并把计数器同步为该值后返回：

- `count`
- `extracted`
- `memberTag`

其中：

- `extracted` 是对 `firstName + lastName` 执行 `NAME_EXTRACT_REGEX` 后得到的结果
- `count` 会被同步为昵称里提取出的 Unicode 数字对应的普通数字
- `memberTag` 会读取 `TG_GROUP_ID` 指向的群，并返回当前账号在这个群里的自定义头衔
- 如果正则包含捕获组，优先返回第一个捕获组；否则返回整个匹配内容

`POST /bump` 会执行两个动作：

- 把计数器 `+1`
- 将这个新的计数器值按昵称当前数字的原格式写回昵称

此外，Worker 已配置定时任务，会在每天北京时间 `00:00` 自动执行一次和 `POST /bump` 相同的逻辑。Cloudflare Cron 使用 UTC，因此配置值是 `0 16 * * *`，对应 UTC+8 的次日 `00:00`。

例如：

- `Berry²` bump 后会变成 `Berry³`
- `Berry¹²` bump 后会变成 `Berry¹³`

示例：

```env
NAME_EXTRACT_REGEX=([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$
```

如果姓名是 `Berry²`，则会提取末尾的上标数字。

## 限制

Cloudflare Worker 不能交互式输入手机号验证码，所以首次登录必须在本地执行 `npm run generate:session`，再把得到的 `TG_SESSION` 配到 Worker。

## 关于 WASM

项目当前仍然依赖 `@mtcute/wasm`，不能删除。

原因是 Worker 端使用的 `@mtcute/web` 需要它提供 MTProto 所需的加密与压缩实现。当前代码里已经显式加载 wasm 模块，避免 `wrangler dev` 下的资源定位问题。
