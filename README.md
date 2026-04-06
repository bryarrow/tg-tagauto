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
- `NAME_EXTRACT_REGEX`（可选，用于从昵称提取字符）
- `NAME_EXTRACT_SOURCE`（可选，指定从哪里提取昵称，支持 `first_name`、`last_name`、`full_name`，默认 `full_name`）
- `MEMBER_TAG_EXTRACT_REGEX`（可选，用于从 member tag 中提取字符）
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
- `NAME_EXTRACT_SOURCE`
- `MEMBER_TAG_EXTRACT_REGEX`

```bash
npm run worker:dev
```

## Worker 环境变量

需要在 Cloudflare Worker 中配置这几个绑定或 Secret：

- `TG_API_ID`
- `TG_API_HASH`
- `TG_SESSION`
- `NAME_EXTRACT_REGEX`
- `NAME_EXTRACT_SOURCE`
- `TG_GROUP_ID`（可选）
- `COUNTER`（Durable Object，已在 `wrangler.toml` 中声明）

## 功能

`GET /` 会读取 Telegram 当前昵称中的数字，并把计数器同步为该值后返回：

- `count`
- `extracted`
- `memberTag`
- `memberTagCount`
- `memberTagExtracted`
- `memberTagError`

其中：

- `extracted` 是对 `NAME_EXTRACT_SOURCE` 指定来源执行 `NAME_EXTRACT_REGEX` 后得到的结果；没匹配到时为 `null`
- `count` 会被同步为昵称里提取出的 Unicode 数字对应的普通数字
- `memberTag` 会读取 `TG_GROUP_ID` 指向的群，并返回当前账号在这个群里的自定义头衔
- `memberTagExtracted` 会对 `memberTag` 执行 `MEMBER_TAG_EXTRACT_REGEX`；没匹配到时为 `null`
- `memberTagCount` 会同步为 `memberTag` 里提取出的 Unicode 数字对应的普通数字
- `memberTagError` 会返回读取或更新成员 tag 时遇到的错误
- 如果正则包含捕获组，优先返回第一个捕获组；否则返回整个匹配内容
- 如果没有配置对应正则，或者没匹配到数字，不会报错，也不会修改对应计数器

`POST /bump` 会执行两个动作：

- 昵称能匹配到 `NAME_EXTRACT_REGEX` 且提取结果包含数字时，才会把昵称计数器 `+1` 并写回昵称
- 成员 tag 能匹配到 `MEMBER_TAG_EXTRACT_REGEX` 且提取结果包含数字时，才会把成员 tag 计数器 `+1` 并写回成员 tag
- 任意一边没匹配到时，会直接跳过，不做任何操作

此外，Worker 已配置定时任务，会在每天北京时间 `00:00` 自动执行一次和 `POST /bump` 相同的逻辑。Cloudflare Cron 使用 UTC，因此配置值是 `0 16 * * *`，对应 UTC+8 的次日 `00:00`。

例如：

- `Berry²` bump 后会变成 `Berry³`
- `Berry¹²` bump 后会变成 `Berry¹³`

示例：

```env
NAME_EXTRACT_REGEX=([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$
NAME_EXTRACT_SOURCE=full_name
MEMBER_TAG_EXTRACT_REGEX=([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$
```

如果 `NAME_EXTRACT_SOURCE=full_name` 且姓名是 `Berry²`，则会提取末尾的上标数字。

## 限制

Cloudflare Worker 不能交互式输入手机号验证码，所以首次登录必须在本地执行 `npm run generate:session`，再把得到的 `TG_SESSION` 配到 Worker。

## 关于 WASM

项目当前仍然依赖 `@mtcute/wasm`，不能删除。

原因是 Worker 端使用的 `@mtcute/web` 需要它提供 MTProto 所需的加密与压缩实现。当前代码里已经显式加载 wasm 模块，避免 `wrangler dev` 下的资源定位问题。
