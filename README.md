# 中俄贸易文件助手

面向中俄贸易操作场景的本地优先桌面工具。当前仓库已完成 M2 离线翻译任务闭环：Electron 桌面端可安全导入 `.xlsx`，经 Python Worker 建立可恢复任务，优先提供本地精确缓存和术语候选，并支持人工确认。

## 当前范围

M1—M2 已实现：

- 原生文件选择与单文件拖入；
- 工作表、有效行列数和表头候选识别；
- 箱号列、俄文原文列、已有译文列的推荐与手动修正；
- 最多 12 行的只读预览，以及 Excel 行号和单元格坐标映射；
- 10 MiB、5,000 行、200 列的导入边界；
- 合并单元格、公式、隐藏工作表和高风险对象提示；
- 条件格式、数据验证、图表、绘图对象、外部链接的受限预览策略；
- SQLite 任务、逐行状态、本地术语和精确缓存持久化；
- 默认 50 行小批次处理，以及批次后暂停、恢复、中止和失败重试；
- URL、邮箱、箱号、编号、日期、金额、型号、单位与数字保护；
- 术语/缓存候选人工确认、未命中内容人工填写；
- 重启后加载未完成任务。

当前不包含在线翻译、本地模型和 Excel 导出。M3 将实现完整审核与安全导出；M4 再完善历史、术语导入导出、设置和自动清理。

## 环境要求

- Windows 10/11；
- Node.js `22.12.0` 或更高兼容版本；
- npm `10` 或更高版本；
- Python `3.11` 或更高版本。

## 开发命令

```powershell
npm install
python -m pip install -r workers/excel-worker/requirements.txt
npm run dev
```

`npm run dev` 会先检查并按需准备 Electron 运行时。Electron 42 起不再通过 `postinstall` 自动下载二进制，因此首次启动需要可访问 Electron 下载源。

常用验证：

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

如需指定 Python或隔离本地开发数据：

```powershell
$env:RUS_TRADE_PYTHON = 'C:\Path\To\python.exe'
$env:RUS_TRADE_DATA_DIR = 'D:\Temp\rus-trade-dev-data'
npm run dev
```

## 工程结构

```text
.
├─ apps/desktop/                 Electron + Vue 桌面端
│  └─ src/
│     ├─ main/                  窗口、活动工作簿会话、Worker 与安全 IPC
│     ├─ preload/               最小受控 API 与拖入文件路径解析
│     └─ renderer/              Excel 结构预检与离线翻译任务台
├─ packages/shared/             TypeScript 协议类型与 JSON Schema
├─ workers/excel-worker/        Excel 解析、SQLite、离线匹配与协议测试
├─ resources/samples/           脱敏固定回归样本
└─ docs/                        产品、架构和决策文档
```

## 安全边界

- Renderer 不启用 Node.js，不能直接访问文件系统、数据库或启动子进程；
- 文件选择、路径校验和活动工作簿会话归 Electron Main 管理；
- Preload 只暴露工作簿、翻译任务和 Worker 诊断白名单；
- 后续预览与任务创建只提交临时 `workbookId`，Main 再映射到真实路径；
- Python Worker 标准输出只允许 JSON Lines 协议消息；
- SQLite 只能由 Python Worker 读写，术语和缓存命中只生成待确认候选；
- 当前版本不修改或导出原文件，不启用在线翻译，也不上传文件或业务数据。

详细协议参见 [IPC 与 Worker 协议](docs/architecture/ipc-protocol.md)，阶段知识参见 [M1 Excel 导入知识快照](docs/architecture/m1-excel-import.md) 与 [M2 离线翻译任务知识快照](docs/architecture/m2-offline-translation.md)。
