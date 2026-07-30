# 中俄贸易文件助手｜M0 工程知识快照

## 阶段结论

M0 建立的是桌面端与 Python 文件处理进程之间的安全通信基线，不包含
Excel 业务功能。当前最小闭环为：

```text
启动桌面端
→ Renderer 调用受控 Preload API
→ Main 向 Python Worker 发送 get_worker_info
→ Worker 返回版本和运行环境
→ 诊断页展示结果
```

## 核心技术名词

- **Main**：Electron 主进程，拥有窗口、IPC、文件与 Worker 管理权限；
- **Preload**：隔离桥，只向页面暴露经过白名单控制的函数；
- **Renderer**：Vue 页面，不具备 Node.js 和本地文件权限；
- **WorkerClient**：Main 内的 JSON Lines 请求管理器；
- **Python Worker**：后续承载 Excel 解析、保护规则和安全写回；
- **协议真源**：`packages/shared` 中的 TypeScript 类型和 JSON Schema。

## 已确定约束

- Python Worker 是后续 SQLite 的唯一读写方；
- M0—V1 使用单 Worker，长任务串行；
- 所有协议消息携带稳定请求 ID 与协议版本；
- Worker 标准输出不能混入日志；
- 在线翻译暂不启用；
- UI 中文文案使用 `t('原中文文本')`；
- 新翻译列在后续阶段只能追加到数据区右侧。
- Main 与沙箱化 Preload 会将 `packages/shared` 打入构建产物；
- 沙箱化 Preload 使用 CommonJS，不能直接使用 ESM `.mjs` 产物。

## 版本与工具链

- Electron `43`；
- electron-vite `5`；
- Vue `3.5`；
- TypeScript `5.9`；
- Python `3.11+`；
- ESLint `8` + Airbnb Base。

TypeScript 固定在 5.9，是因为 Airbnb Base 当前依赖 ESLint 8，而与其兼容的
TypeScript ESLint 工具链尚不支持 TypeScript 7。该选择优先保证规则链稳定。

Electron 42 起不再通过 npm `postinstall` 下载运行时。根目录 `predev` 会调用
`scripts/ensure-electron.cjs` 按需准备二进制；该脚本同时兼容当前开发机遗留的
`ELECTRON_CUSTOM_DIR=v%%version%%` 配置。

## 下一阶段注意事项

M1 开始前仍需确认：

- Excel 最大文件大小与最大行数；
- 高风险 Excel 是只读预览还是允许确认后导出；
- 历史、任务行和缓存的默认保留期限；
- 输出文件命名的自定义范围。

更新（2026-07-30）：上述四项已分别在 DR-008—DR-011 确认，并已进入 M1 实现；后续阶段知识以 `docs/architecture/m1-excel-import.md` 为准。

M1 不应让 Renderer 直接解析文件或访问数据库；所有文件能力继续由 Main
和 Python Worker 通过已版本化协议提供。
