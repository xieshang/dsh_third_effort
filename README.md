# dsh-third-effort

DSH 插件（Host 半 + Client 半）：

1. 让第三方供应商（`llm-pi-ai` 手工路由）的模型在会话里显示**推理等级**，并且把所选等级带进请求。
2. 会话输入框工具行、权限选择右边加一个**显示时间**滑动开关：打开时每条消息的时间戳常显（当天 `HH:mm`，非当天 `日期 HH:mm`）；关闭时恢复官方悬停显示。
3. **自动追问**：一次会话的 turn 停止后（报错停止或 EOF 完整停止），自动注入一条追问「任务是否已全部完成」；如果模型回复已完成就到此为止，如果还没做完就让它继续推进直到完成为止；模型正在等用户决策时**不发送**。

## 为什么需要它

- 手工路由的模型条目通常只有 `- id: xxx`，没有 `reasoningEfforts` 声明。
- pi-ai 适配器于是上报 `reasoning: undefined` → 模型目录里该模型没有推理元数据 → composer 的推理等级（Effort）行直接隐藏。
- 没有 Effort 行就选不了等级，请求里自然也没有 `reasoningEffort`。

## 它做什么

启动后（等 `llm-pi-ai` 的 settings 命名空间就绪）：

1. 读 `llm-pi-ai` 分节的 `providers`（只读已存储的用户层，不碰凭据）。
2. 对配置覆盖的路由（默认全部非目录路由），逐模型用 `llm.resolveModelInfo` 查实时能力。
3. 当前**没有**推理能力的模型 → 用 `settings.update`（merge，只补字段）给它的 `models` 条目写上 `reasoningEfforts`（默认 `off/low/medium/high/xhigh/max`）。
4. 写入走适配器自带的 `assertServiceable` 校验，写不进去就大声报错、不静默。
5. 之后官方链路自动接管：目录重拉 → Effort 行出现 → `selectModel → resolveCallConfig → prepareCall` 把等级带进请求。本插件不加任何请求路径。

## 安全规则

- 已声明 `reasoningEfforts`（哪怕是 `false`）的模型默认不动（`overwrite: false`）。
- 只补 `models` 条目字段，不读不写 `apiKeyEnv` 与其它字段。
- 只增不删：插件从不删除声明；`settings/document-updated` 触发时只处理新增的未覆盖模型。
- 写入失败（网关方言不支持等）只记日志，不影响其它路由。

## 安装

```sh
dsh plugin --profile web add G:\XSC\!Project\DSH_third_effort
```

config-manager / approve-builds 的老坑：如果 add 失败，先在 profile 目录跑 `pnpm approve-builds --all` 后重试。

Host 插件需要重启 `dsh web` 生效（client 插件才只需硬刷新）。

## 配置（cordis.patch.yml 行内 config）

| key | 默认 | 说明 |
|---|---|---|
| `providers` | `['*']` | 覆盖的路由名；`'*'` = 分节里声明的全部路由 |
| `efforts` | `off/low/medium/high/max` | 菜单等级 id → wire 拼写；只列网关认识的等级 |
| `overwrite` | `false` | 是否覆盖已有声明（默认只补缺） |
| `rescanMs` | `60000` | 运行中重扫间隔；`0` = 只在启动跑一次 |
| `autoVerify` | `true` | 是否启用自动追问 |
| `verifyPrompt` | 内置默认 | 注入的追问文案（可选覆盖） |
| `verifyMaxRounds` | `3` | 每次人工输入后连续自动追问的最大轮数（防止坏循环无限刷屏） |
| `enabled` | — | 设 `false` 停用 |

## 验证

### 推理等级

1. 重启 `dsh web`，看日志有 `third-effort: declared reasoningEfforts for N model(s) on route "xxx"`。
2. 会话 composer 点模型 → 出现「推理等级」行 → 选 High。
3. 发一句话，看网关/上游收到的请求带 `reasoning_effort: high`（opencode2api 类网关：下游自带字段优先透传，`hasDownstreamReasoning` 为真即不再套默认值）。

### 显示时间开关

1. 重启 `dsh web` 后**硬刷新浏览器**（client 半只改了浏览器侧）。
2. 会话输入框工具行、权限选择右边出现「显示时间」滑动开关（默认开）。
3. 打开：每条消息的时间常显（当天 `HH:mm`，今年内 `M月d日 HH:mm`，跨年 `年月日 HH:mm`）；关闭：恢复官方悬停才显示。
4. 选择记在浏览器 localStorage，换浏览器/清缓存后恢复默认（开）。

### 自动追问

1. 重启 `dsh web`（Host 半改动生效）。
2. 给模型一个多步任务，等它正常结束（EOF）或中途报错停下。
3. 日志出现 `third-effort: auto-verify follow-up queued`，模型会自动再发一轮确认/收尾。
4. 模型回复「任务已完成」后不再追问；模型反问等你选择时也不追问；用户手动停止（aborted）也不追问。
5. 同一段人工对话内连续自动追问最多 `verifyMaxRounds`（默认 3）轮。
