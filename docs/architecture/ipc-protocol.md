# 中俄贸易文件助手｜IPC 与 Worker 协议

> 协议版本：`1.0`
> 应用里程碑：`0.3.0 / M2`
> 适用范围：M0—V1 单 Worker 模式

## 1. 调用链路

```text
Vue Renderer
→ Preload 白名单 API
→ Electron ipcMain
→ 工作簿会话与 IPC 字段校验
→ WorkerClient
→ Python Worker stdin/stdout
→ SQLite / openpyxl
```

Renderer 不接触 `ipcRenderer`、文件系统、SQLite、Python 路径或子进程参数。文件选择和拖入路径解析分别由 Main 与 Preload 完成；工作簿被接受后，后续请求以临时 `workbookId` 关联 Main 中保存的真实路径。

## 2. Renderer 到 Main 的 IPC

| 通道 | Preload API | 输入 | 说明 |
|---|---|---|---|
| `worker:get-info` | `getWorkerInfo()` | 无 | Worker 诊断 |
| `workbook:select` | `selectWorkbook()` | 无 | 打开原生 `.xlsx` 选择器并预检 |
| `workbook:open-dropped` | `openDroppedWorkbook(file)` | 浏览器 `File` | Preload 提取本地路径 |
| `workbook:preview-sheet` | `previewWorkbookSheet(request)` | `workbookId`、工作表、表头行 | 返回列、推荐和有限预览 |
| `workbook:build-rows` | `buildWorkbookRows(request)` | 会话、工作表、列配置 | 返回稳定 Excel 行映射 |
| `translation:create-task` | `createTranslationTask(request)` | 会话和列配置 | Main 解析可信路径后创建任务 |
| `translation:get-task` | `getTranslationTask(request)` | `taskId` | 读取任务与全部行 |
| `translation:list-tasks` | `listTranslationTasks(request)` | 完成态开关、数量上限 | 默认读取未完成任务 |
| `translation:process-batch` | `processTranslationBatch(request)` | `taskId`、可选批次大小 | 执行缓存/术语离线匹配 |
| `translation:update-row` | `updateTranslationRow(request)` | 行 ID、译文、缓存开关 | 人工确认译文 |
| `translation:change-state` | `changeTranslationTaskState(request)` | 任务 ID、状态动作 | 暂停、恢复、中止、重试失败项 |

Main 同时只保留一个活动工作簿会话。文件被更换或应用重启后，旧 `workbookId` 返回 `WORKBOOK_SESSION_INVALID`；已创建任务通过 `taskId` 从 SQLite 恢复，不依赖活动会话继续存在。

## 3. Worker JSON Lines 约束

- 每条消息是单行 UTF-8 JSON，以换行符结束；
- 所有消息必须包含 `protocolVersion`、`id` 和 `type`；
- Python 标准输出只允许协议消息，日志写入标准错误；
- M0—V1 一个 Worker 同时只执行一个长任务；
- M2 把长任务拆为默认 50 行、最多 200 行的同步批次；
- 不兼容协议变更必须提升协议主版本号；
- 语言无关 schema 位于 `packages/shared/schemas/worker-protocol.schema.json`。

请求示例：

```json
{
  "protocolVersion": "1.0",
  "id": "req_001",
  "type": "request",
  "action": "process_translation_batch",
  "payload": {
    "taskId": "task_123",
    "batchSize": 50
  }
}
```

成功响应使用 `type: "completed"` 和 `data`；失败响应使用 `type: "error"`，并返回稳定的 `error.code` 与可展示消息。

## 4. Worker 动作

| 动作 | 必要输入 | 输出 |
|---|---|---|
| `get_worker_info` | 无 | Worker、协议、Python、平台版本 |
| `parse_workbook` | `filePath` | 文件摘要、工作表、表头候选、风险和限制状态 |
| `preview_sheet` | 文件、工作表、表头行 | 列定义、列推荐、最多 12 行预览 |
| `build_import_rows` | 文件、工作表、表头行、原文列 | 非空原文行的稳定映射 |
| `create_translation_task` | 文件与列配置 | 持久化任务及全部任务行 |
| `get_translation_task` | `taskId` | 任务摘要及逐行明细 |
| `list_translation_tasks` | 可选过滤条件 | 任务摘要列表 |
| `process_translation_batch` | `taskId`、可选批次大小 | 批次后的完整任务明细 |
| `update_translation_row` | 任务行、译文、缓存开关 | 人工确认后的完整任务明细 |
| `change_translation_task_state` | `taskId`、状态动作 | 状态变更后的完整任务明细 |
| `upsert_glossary_term` | 俄文、中文、可选备注 | 术语及新术语库版本 |
| `list_glossary_terms` | 无 | 当前有效术语列表 |

`rowId` 来源于“工作表名 + Excel 行号 + 原文列字母”。任务行同时保留 `sourceCell`、`targetCell`、`containerCell` 和 `excelRowNumber`；任务创建会由 Worker 重新读取可信文件，不接受 Renderer 传入的任意行内容。

## 5. 稳定错误码

除 M1 的文件、工作簿、会话和列配置错误外，M2 新增：

| 错误码 | 含义 |
|---|---|
| `DATABASE_ERROR` | SQLite 打开、迁移或读写失败 |
| `TASK_NOT_FOUND` / `TASK_ROW_NOT_FOUND` | 任务或任务行不存在 |
| `TASK_ROWS_EMPTY` | 没有可建立任务的原文行 |
| `TASK_STATE_INVALID` | 当前状态不允许请求的操作 |
| `TRANSLATOR_UNAVAILABLE` | 配置的翻译器不可用 |
| `TRANSLATION_TIMEOUT` | 翻译处理超时 |
| `TRANSLATION_OUTPUT_INVALID` | 译文为空或输出结构无效 |
| `TOKEN_RESTORE_FAILED` | 保护片段缺失、重复或未完全恢复 |

未分类异常仍返回 `WORKER_INTERNAL_ERROR`，且日志不得记录完整业务原文、译文或请求体。

## 6. M2 安全与一致性约束

- BrowserWindow 使用 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；
- 权限请求、新窗口和任意导航默认拒绝；
- Main 校验 IPC 字段，并将 `workbookId` 映射为可信路径；
- SQLite 仅由 Python Worker 访问，默认位于应用 `userData/data`；
- 可通过 `RUS_TRADE_DATA_DIR` 隔离开发或测试数据；
- 已有译文不自动覆盖；缓存和术语命中只产生人工确认候选；
- 当前不启用在线翻译，不向外部服务发送文件或业务数据；
- 当前不写回或导出原 Excel。
