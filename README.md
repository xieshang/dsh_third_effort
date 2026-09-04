# dsh-third-effort

DeepSeek Harness（DSH）插件，为会话补充三个能力：

1. **推理等级**：让第三方供应商（`llm-pi-ai` 手工路由）的模型显示「推理等级」，并把所选等级带进请求。
2. **显示时间开关**：在会话输入框工具行、权限选择右边加一个滑动开关，控制每条消息的时间戳是否常显。
3. **自动追问**：一次会话的 turn 停止后（报错停止或 EOF 完整停止），自动追问「任务是否已全部完成」；完成了就停，没完成就继续推进直到做完；模型正在等用户决策时**不发送**。

## 安装

最新版（GitHub，推荐）：

```sh
dsh plugin add github:xieshang/dsh_third_effort
```

钉住版本（更稳，适合生产）：

```sh
dsh plugin add github:xieshang/dsh_third_effort#v0.1.0
```

从 npm（发布后可选渠道）：

```sh
dsh plugin add dsh-third-effort
```

本地开发调试：

```sh
dsh plugin add /path/to/dsh_third_effort
```

> 安装完成后**重启 dsh 进程**使 Host 半生效；浏览器侧改动只需硬刷新页面。

## 功能说明

### 1. 推理等级（reasoningEfforts 自动回填）

**为什么**：手工路由的模型条目通常只有 `- id: xxx`，没有 `reasoningEfforts` 声明 → pi-ai 适配器上报 `reasoning: undefined` → 推理等级行隐藏 → 请求里也没有 `reasoningEffort`。

**做了什么**：启动后会等 `llm-pi-ai` 的 settings 命名空间就绪，然后：

1. 读 `llm-pi-ai` 分节的 `providers`（只读用户层，不碰凭据）。
2. 对配置覆盖的路由，逐模型用实时能力查询。
3. 给**没有**推理能力的模型写入 `reasoningEfforts`（默认 `off/low/medium/high/xhigh/max`）。
4. 写入走适配器自身的校验，写不进就大声报错、不静默。
5. 之后官方链路自动接管：目录重拉 → 「推理等级」行出现 → `selectModel → resolveCallConfig → prepareCall` 把等级带进请求。本插件不加任何请求路径。

### 2. 显示时间开关

- 位置：会话输入框工具行、权限选择右边（滑动开关，默认开）。
- 打开：每条消息的时间常显（当天 `HH:mm`，今年内 `M月d日 HH:mm`，跨年 `年月日 HH:mm`）。
- 关闭：恢复官方「悬停才显示」。
- 选择记在浏览器 localStorage，换浏览器/清缓存后恢复默认（开）。

### 3. 自动追问

- 触发：turn 以 `completed`（EOF 完整停止）或 `error`（报错停止）结束时。
- 不打扰：模型已回复完成任务、或正在等你做决策（`aborted`/`blocked` 也不算）时不发。
- 防刷屏：同一段人工输入后连续自动追问最多 `verifyMaxRounds` 轮（默认 3）。
- 只作用于顶层会话，不打扰被委派的子代理。

## 配置（cordis.patch.yml 行内 config）

| key | 默认 | 说明 |
|---|---|---|
| `providers` | `['*']` | 覆盖的路由名；`'*'` = 分节里声明的全部路由 |
| `efforts` | `off/low/medium/high/max` | 菜单等级 id → wire 拼写；只列网关认识的等级 |
| `overwrite` | `false` | 是否覆盖已有声明（默认只补缺） |
| `rescanMs` | `60000` | 运行中重扫间隔；`0` = 只在启动跑一次 |
| `autoVerify` | `true` | 是否启用自动追问 |
| `verifyPrompt` | 内置默认 | 注入的追问文案（可选覆盖，见下） |
| `verifyMaxRounds` | `3` | 每次人工输入后连续自动追问的最大轮数 |
| `enabled` | — | 设 `false` 停用 |

自定义追问文案示例：

```yaml
- insert:
    - id: third-effort
      config:
        autoVerify: true
        verifyPrompt: |
          请汇报当前任务进度：如已全部完成请直接回复“任务已完成”；
          如有未完成项请继续推进，全部做完后再回复“任务已完成”。
```

## 验证

- **推理等级**：模型菜单出现「推理等级」行 → 选 High → 发出的请求带 `reasoning_effort: high`。
- **显示时间**：开关打开后消息时间常显；关闭后恢复悬停显示。
- **自动追问**：给模型一个多步任务，等它结束或报错停下，日志出现 `third-effort: auto-verify follow-up queued`，模型自动补一轮确认/收尾；回复「任务已完成」后不再追问。

## 卸载

```sh
dsh plugin remove dsh-third-effort
```

并删除 `cordis.patch.yml` 里对应的 `third-effort` 行（或按 DSH 的卸载流程自动回滚补丁）。

重启 dsh 生效。

## 仓库

- GitHub：<https://github.com/xieshang/dsh_third_effort>
- npm（发布后）：`dsh-third-effort`

## License

MIT