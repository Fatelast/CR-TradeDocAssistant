# 中俄贸易文件助手

面向中俄贸易操作场景的本地优先桌面工具。当前仓库已完成 M1—M4 离线业务闭环和 M5 Beta 打包工程：Python Worker 已冻结为独立 EXE，Electron 已生成并验证 NSIS x64 安装包，Windows 11 本机安装、启动和卸载链路通过。

## 当前范围

M1—M4 功能闭环和 M5 Beta 打包工程已实现：

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
- 重启后加载未完成和已完成任务；
- 审核搜索、状态筛选、忽略、恢复初始候选和离线重新匹配；
- 源文件 SHA-256 指纹、任务完成度和 Excel 风险导出预检；
- 已有译文列安全写回，或在有效数据区右侧追加新列；
- 同目录临时文件保存、重开逐格验证和最终副本输出；
- 原文件、已存在输出路径和高风险工作簿导出阻断；
- schema v3 迁移，以及任务、逐行数据和旧术语的兼容保留；
- 任务历史分页、搜索、详情、可信文件打开、重新执行和终态记录删除；
- 每次导出的 `pending/completed/recovered/failed` 审计记录；
- 术语分页管理、标准 XLSX 原子导入与重开验证导出；
- 精确缓存只读查询，以及选中、过期和全部缓存清理；
- 默认输出目录、1～200 批次大小、日志级别和设置 JSON 导出；
- 终态任务 90 天、缓存 180 天、按日日志 30 天的固定保留策略；
- 所有清理操作先预览后确认，且永不删除业务 Excel 文件；
- PyInstaller `onedir` Worker 独立打包和 UTF-8 JSON Lines；
- 开发环境 Python 启动与安装环境 Worker EXE 双路径；
- electron-builder、ASAR、NSIS x64 和卸载保留 AppData 配置；
- 1024px PNG、多尺寸 ICO、第三方许可和安装包 SHA-256 校验脚本；
- 三份合成脱敏 Beta 演示样本及其 SHA-256、导入—审核模拟—导出—输出重读校验。

当前不包含在线翻译或本地模型。M5 工程实现、NSIS 产物、Windows 11 本机安装链路和三份合成脱敏样本的技术闭环已经完成；Beta 仍需用 Excel 或 WPS 任一软件人工复开一次导出文件。Windows 10/11 干净机器、迁移数据副本、Excel/WPS 双验证、脱敏真实文件和业务签字验收仍是 `1.0.0` 发布前置条件。

## 开发环境要求

- Windows 10/11；
- Node.js `22.12.0` 或更高兼容版本；
- npm `10` 或更高版本；
- Python `3.11` 或更高版本。

安装后的应用不需要 Node.js、npm 或 Python。

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

Windows Beta 打包：

```powershell
python -m pip install -r workers/excel-worker/requirements-build.txt
npm run package:worker
npm run test:worker:packaged
npm run package:desktop
npm run verify:artifacts
```

Beta 三份脱敏演示样本的技术闭环使用 `npm run verify:beta-samples`；完整发布验证使用 `npm run verify:release`。

如需指定 Python 或隔离本地开发数据：

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
│     └─ renderer/              工作台、历史、术语/缓存与设置维护界面
├─ packages/shared/             TypeScript 协议类型与 JSON Schema
├─ workers/excel-worker/        Excel 解析、SQLite、离线匹配、安全导出与协议测试
├─ resources/
│  ├─ icons/                    应用 PNG/ICO 图标
│  ├─ licenses/                 随包分发的第三方许可全文
│  └─ samples/                  脱敏固定回归样本
└─ docs/                        产品、架构和决策文档
```

## 安全边界

- Renderer 不启用 Node.js，不能直接访问文件系统、数据库或启动子进程；
- 文件选择、路径校验和活动工作簿会话归 Electron Main 管理；
- Preload 只暴露工作簿、翻译、历史、术语、缓存、设置和维护白名单；
- 后续预览与任务创建只提交临时 `workbookId`，Main 再映射到真实路径；
- Python Worker 标准输出只允许 JSON Lines 协议消息；
- SQLite 只能由 Python Worker 读写，术语和缓存命中只生成待确认候选；
- Renderer 不能提供导入、导出或历史打开路径；Main 通过原生对话框和数据库可信记录解析路径；
- 导出只生成新 `.xlsx` 副本，禁止覆盖原文件或已有文件，并在最终落盘前重开验证；
- 当前不启用在线翻译，也不上传文件或业务数据。

详细协议参见 [IPC 与 Worker 协议](docs/architecture/ipc-protocol.md)，阶段知识参见 [M1 Excel 导入知识快照](docs/architecture/m1-excel-import.md)、[M2 离线翻译任务知识快照](docs/architecture/m2-offline-translation.md) 、[M3 审核与安全导出知识快照](docs/architecture/m3-review-export.md) 、[M4 本地数据知识快照](docs/architecture/m4-local-data.md) 与 [M5 打包工程知识快照](docs/architecture/m5-packaging.md)。安装和发布验收分别参见 [安装与使用说明](docs/中俄贸易文件助手-安装与使用说明.md)、[M5 发布验收清单](docs/testing/m5-release-checklist.md) 与 [`0.6.0-beta.1` 发布说明](docs/releases/v0.6.0-beta.1.md)。
