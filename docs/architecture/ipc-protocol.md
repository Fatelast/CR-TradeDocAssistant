# 中俄贸易文件助手｜IPC 与 Worker 协议

> 协议版本：`1.0`  
> 应用里程碑：`0.2.0 / M1`  
> 适用范围：M0—V1 单 Worker 模式

## 1. 调用链路

```text
Vue Renderer
→ Preload 白名单 API
→ Electron ipcMain
→ 活动工作簿会话校验
→ WorkerClient
→ Python Worker stdin/stdout
```

Renderer 不接触 `ipcRenderer`、文件系统、Python 路径或子进程参数。文件选择和拖入文件路径解析分别由 Main 与 Preload 完成；工作簿被接受后，后续请求以临时 `workbookId` 关联 Main 中保存的真实路径。

## 2. Renderer 到 Main 的 IPC

| 通道 | Preload API | 输入 | 说明 |
|---|---|---|---|
| `worker:get-info` | `getWorkerInfo()` | 无 | Worker 诊断 |
| `workbook:select` | `selectWorkbook()` | 无 | 打开原生 `.xlsx` 选择器并预检 |
| `workbook:open-dropped` | `openDroppedWorkbook(file)` | 浏览器 `File` | Preload 使用 Electron `webUtils` 提取本地路径 |
| `workbook:preview-sheet` | `previewWorkbookSheet(request)` | `workbookId`、工作表、表头行 | 返回列信息、推荐和有限预览 |
| `workbook:build-rows` | `buildWorkbookRows(request)` | 会话、工作表、列配置 | 返回稳定行号与单元格映射 |

Main 同时只保留一个活动工作簿会话。文件被更换或应用重启后，旧 `workbookId` 返回 `WORKBOOK_SESSION_INVALID`。

## 3. Worker JSON Lines 约束

- 每条消息是单行 UTF-8 JSON，以换行符结束；
- 所有消息必须包含 `protocolVersion`、`id` 和 `type`；
- Python 标准输出只允许协议消息，日志写入标准错误；
- M0—V1 一个 Worker 同时只执行一个长任务；
- 不兼容协议变更必须提升协议主版本号；
- 语言无关 schema 位于 `packages/shared/schemas/worker-protocol.schema.json`。

请求示例：

```json
{
  "protocolVersion": "1.0",
  "id": "req_001",
  "type": "request",
  "action": "preview_sheet",
  "payload": {
    "filePath": "D:\\samples\\feedback.xlsx",
    "sheetName": "问题反馈",
    "headerRow": 2
  }
}
```

成功响应使用 `type: "completed"` 和 `data`；失败响应使用 `type: "error"`，并返回稳定的 `error.code` 与可展示消息。

## 4. Worker 动作

| 动作 | 必要输入 | 输出 |
|---|---|---|
| `get_worker_info` | 无 | Worker、协议、Python、平台版本 |
| `parse_workbook` | `filePath` | 文件摘要、工作表、表头候选、风险和限制状态 |
| `preview_sheet` | `filePath`、`sheetName`、`headerRow` | 列定义、列推荐、最多 12 行预览 |
| `build_import_rows` | 文件、工作表、表头行、原文列 | 非空原文行的稳定映射；箱号列和目标列可选 |

`build_import_rows` 的 `rowId` 由“工作表名 + Excel 行号 + 原文列字母”组成；每行同时保留 `sourceCell`、`targetCell`、`containerCell` 和 `excelRowNumber`，供 M2 继续建立任务状态。

## 5. 导入限制与稳定错误码

| 错误码 | 含义 |
|---|---|
| `INVALID_MESSAGE` | JSON、IPC 或消息字段无效 |
| `PROTOCOL_VERSION_UNSUPPORTED` | 协议版本不兼容 |
| `UNSUPPORTED_ACTION` | Worker 不支持该动作 |
| `WORKER_START_FAILED` / `WORKER_TIMEOUT` / `WORKER_EXITED` | Worker 启动、超时或异常退出 |
| `FILE_SELECTION_FAILED` / `FILE_NOT_FOUND` / `FILE_UNSUPPORTED` / `FILE_LOCKED` | 文件选择或访问失败 |
| `FILE_TOO_LARGE` | 文件超过 10 MiB |
| `WORKBOOK_OPEN_FAILED` / `WORKBOOK_ENCRYPTED` | 工作簿无法打开或已加密 |
| `WORKBOOK_ARCHIVE_TOO_LARGE` | ZIP 条目过多或解压后体积超过安全阈值 |
| `WORKBOOK_SESSION_INVALID` | 活动工作簿会话已失效 |
| `ROW_LIMIT_EXCEEDED` / `COLUMN_LIMIT_EXCEEDED` | 有效区域超过 5,000 行或 200 列 |
| `SHEET_NOT_FOUND` / `HEADER_NOT_FOUND` | 工作表或表头配置无效 |
| `SOURCE_COLUMN_INVALID` / `TARGET_COLUMN_INVALID` | 列配置越界或冲突 |
| `WORKER_INTERNAL_ERROR` | 未分类内部错误 |

## 6. M1 安全约束

- BrowserWindow 使用 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；
- 所有权限请求与新窗口默认拒绝；
- Main 只接受 `.xlsx`，并校验活动会话和 IPC 字段；
- Worker 在打开工作簿前执行 ZIP 条目和解压体积预检；
- openpyxl 使用只读模式，公式仅展示，不计算也不写回；
- 高风险对象标记为 `restricted`，M1 只提供只读预览；
- 日志不得记录请求体、完整业务文本或未来翻译内容。
