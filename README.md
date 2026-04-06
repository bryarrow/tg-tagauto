# tg-tagauto

基于 `mtcute` 和 Cloudflare Workers 的 Telegram 自动计数工具。它会读取昵称或群头衔中的数字，和 Durable Object 里的计数器同步，并支持手动或定时递增。

## 代码结构

- `src/worker.ts`：Worker 入口，只保留 HTTP/cron 编排。
- `src/telegram.ts`：Telegram 客户端、授权检查、群头衔读写。
- `src/counter.ts`：Durable Object 计数器访问封装。
- `src/extract.ts`：正则提取和字符串替换。
- `src/digits.ts`：Unicode 数字归一化与原样式格式化。
- `src/generate-session.ts`：本地登录并生成 `TG_SESSION`。

## Telegram API 凭据申请

项目依赖 Telegram 官方提供的 `api_id` 和 `api_hash` 访问 MTProto。申请步骤如下：

1. 登录 `https://my.telegram.org`。
2. 使用你的 Telegram 账号收取验证码并登录。
3. 进入 `API development tools`。
4. 创建一个应用，常见字段可按下面填写：

- `App title`：随便填一个你能识别的名字，例如 `tg-tagauto`
- `Short name`：简短英文标识，例如 `tgtagauto`
- `Platform`：任选一个接近的客户端类型，例如 `Desktop`
- `Description`：简单写用途，例如 `Cloudflare worker automation`

创建完成后页面会显示：

- `App api_id`：对应本项目的 `TG_API_ID`
- `App api_hash`：对应本项目的 `TG_API_HASH`

使用方式：

- 本地放进 `.env`，用于执行 `npm run generate:session`
- 本地调试时同步放进 `.dev.vars`
- 部署到 Cloudflare 后分别配置成 Worker secret `TG_API_ID` 和 `TG_API_HASH`

注意：

- `api_id` / `api_hash` 绑定的是你的 Telegram 开发应用，不是 BotFather 的 bot token，二者不能混用。
- 这两个值等同于账号级凭据，泄露后别人可以借助你的应用身份发起登录流程，不要提交到仓库。
- 如果怀疑泄露，应尽快回到 `my.telegram.org` 重新生成或更换应用。

## 部署与使用

1. 安装依赖。

```bash
npm install
```

2. 初始化本地环境文件。

```bash
copy .env.example .env
copy .env.example .dev.vars
```

3. 在 `.env` 中填写 `TG_API_ID` 和 `TG_API_HASH`，然后生成登录 session。

```bash
npm run generate:session
```

脚本会交互式登录 Telegram，并把导出的 mtcute 原生 `TG_SESSION` 写回 `.env`。如果你原来保存的是 GramJS session，脚本会先尝试转换。

4. 把相同配置写入 `.dev.vars`，本地检查构建。

```bash
npm run build
npm run worker:check
```

5. 部署到 Cloudflare Worker。

```bash
wrangler secret put TG_API_ID
wrangler secret put TG_API_HASH
wrangler secret put TG_SESSION
wrangler secret put AUTH_TOKEN
wrangler deploy
```

`COUNTER` Durable Object 已在 [wrangler.toml](/D:/codes/tg-tagauto/wrangler.toml) 中声明。当前 cron 为 `0 16 * * *`，对应北京时间每天 `00:00`。

## 接口说明

- `GET /`：读取昵称和群头衔，提取数字并同步计数器。
- `POST /bump`：对昵称和群头衔中的数字各自加一，无法匹配时跳过。必须携带请求头 `X-Auth-Token: <token>`。
- `scheduled`：执行与 `POST /bump` 相同的流程。

返回字段：

- `count`：昵称计数器。
- `extracted`：从昵称提取出的文本。
- `memberTag`：当前群头衔。
- `memberTagCount`：群头衔计数器。
- `memberTagExtracted`：从群头衔提取出的文本。
- `memberTagError`：群头衔读取或写入时的错误。

## 环境变量

必填：

- `TG_API_ID`
- `TG_API_HASH`
- `TG_SESSION`
- `AUTH_TOKEN`

可选：

- `NAME_EXTRACT_REGEX`
- `NAME_EXTRACT_SOURCE`
- `MEMBER_TAG_EXTRACT_REGEX`
- `TG_GROUP_ID`

`NAME_EXTRACT_SOURCE` 支持 `first_name`、`last_name`、`full_name`，默认 `full_name`。

`AUTH_TOKEN` 用于保护 `POST /bump`。它应配置为一个随机长字符串，并通过请求头 `X-Auth-Token` 传入。

示例：

```env
AUTH_TOKEN=replace-with-a-long-random-string
NAME_EXTRACT_REGEX=([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$
NAME_EXTRACT_SOURCE=full_name
MEMBER_TAG_EXTRACT_REGEX=([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$
TG_GROUP_ID=-1001234567890
```

调用示例：

```bash
curl -X POST "https://<your-worker>.workers.dev/bump" ^
  -H "X-Auth-Token: <your-token>"
```

## 注意事项

- 首次登录必须在本地执行 `npm run generate:session`，Worker 里不能交互式输入验证码。
- Worker 端只接受 mtcute 原生 `TG_SESSION`。
- `POST /bump` 现在必须带 `X-Auth-Token`，否则会返回 `401`。
- 正则如果带捕获组，优先使用第一个捕获组；否则使用整个匹配结果。
- 只有提取结果里存在数字时，才会同步或递增计数器。
- `full_name` 模式下，匹配范围不要跨越名和姓的边界，否则不会回写。
- 群头衔功能依赖 `TG_GROUP_ID`，并且账号需要具备读取/修改对应头衔的权限。
- `@mtcute/wasm` 仍然是必须依赖，Worker 侧的加密与压缩实现要用到它。
