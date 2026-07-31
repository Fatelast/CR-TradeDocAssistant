# 中俄贸易文件助手｜M5 打包与内测设计

> 目标版本：`0.6.0-beta.1`  
> 目标平台：Windows 10/11 x64  
> 发布形态：内部测试版、完全离线、暂不签名

## 1. 阶段目标

M5 将 M1—M4 的开发环境闭环转换为普通 Windows 用户可安装的桌面应用。安装后不需要 Node.js、Python、数据库服务或网络连接。

M5 不新增在线翻译、本地模型、OCR、自动更新、账户、云同步或 SQLite 整库恢复。SQLite schema 保持 `3`，Worker 协议保持 `1.0`。

## 2. 构建架构

```text
Python 源码
  → PyInstaller onedir + console
  → workers/excel-worker/dist/rus-trade-worker/
       ├─ rus-trade-worker.exe
       └─ _internal/

Electron/Vue 源码
  → electron-vite build
  → out/

out/ + Worker 目录 + 第三方许可 + 应用图标
  → electron-builder + NSIS x64
  → release/CR-TradeDocAssistant-<version>-x64-setup.exe
```

Worker 使用 `console=True` 保留 stdin/stdout/stderr；Electron 通过 `windowsHide: true` 隐藏控制台。`main.py` 主动将三个标准流重配为 UTF-8，防止冻结程序继承 Windows 系统代码页后破坏 JSON Lines 中文字段。

## 3. 开发与生产启动契约

| 环境 | 可执行程序 | 参数 |
|---|---|---|
| 开发 | `RUS_TRADE_PYTHON` 或 `python` | `workers/excel-worker/src/main.py` |
| 安装包 | `resources/worker/rus-trade-worker.exe` | 无 |

生产环境不读取 `RUS_TRADE_PYTHON`，因此不会退回系统 Python，也不会执行 Renderer 提供的路径。数据目录继续由 Electron Main 注入为 `app.getPath('userData')/data`。

## 4. 安装包资源与隔离

- Electron 代码启用 ASAR；
- Worker `onedir` 完整复制到 `resources/worker`，不放入 ASAR；
- 图标使用 `resources/icons/app-icon.ico`；
- 第三方摘要复制为 `resources/THIRD_PARTY_NOTICES.md`，许可全文复制到 `resources/licenses/`；
- 安装器采用 NSIS 辅助安装模式、当前用户安装、允许选择安装目录；
- `deleteAppDataOnUninstall=false`，卸载不删除用户数据；
- 不生成自动更新元数据，不配置发布服务。

预期用户数据：

```text
%APPDATA%/中俄贸易文件助手/
├─ data/
│  └─ app.db
└─ logs/
   └─ main-YYYY-MM-DD.log
```

源 Excel 和输出 Excel 始终位于用户选择的业务目录，不属于安装器或卸载器管理范围。

## 5. 构建命令

```powershell
python -m pip install -r workers/excel-worker/requirements-build.txt
npm install
npm run package:worker
npm run test:worker:packaged
npm run package:desktop
npm run verify:artifacts
```

统一发布验证命令：

```powershell
npm run verify:release
```

`verify:artifacts` 检查安装器、`app.asar`、Worker EXE 和许可文件，限制安装器不超过 300 MiB，并生成 `release/SHA256SUMS.txt`。

## 6. 测试层次

1. 源码单元与协议测试；
2. Worker 开发/冻结双运行时测试；
3. 打包路径与 NSIS 数据保留配置测试；
4. 解包目录结构和 SHA-256 校验；
5. 无 Node.js/Python 的干净 Windows 安装测试；
6. schema v2/v3 数据副本升级测试；
7. Microsoft Excel 与 WPS 的脱敏真实样本回归；
8. 安装、覆盖升级、降级阻断和卸载数据保留测试。

## 7. 发布门槛

只有同时满足以下条件，才可将 `0.6.0-beta.1` 提升为 `1.0.0`：

- 安装器在 Windows 10、Windows 11 x64 干净环境成功安装和启动；
- 无 Python、Node.js、网络时可完成导入、离线匹配、审核和导出；
- schema v2/v3 数据升级后任务、术语、设置和导出审计不丢失；
- 卸载不删除 `userData/data` 和任何业务 Excel；
- 固定样本和脱敏真实样本在 Excel/WPS 中可重新打开；
- P0/P1 缺陷为 0，P2 缺陷有明确规避说明；
- 生成安装包校验值、版本说明、已知限制和用户手册。

## 8. 风险与成本边界

- 内测包暂不签名，Windows SmartScreen 可能提示未知发布者；
- PyInstaller 可能因构建机已安装可选依赖而增加体积，发布构建应使用干净 Python 环境；
- 杀毒软件可能对未签名的 PyInstaller 程序误报，需要在目标电脑实测；
- 当前仓库只有 3 个合成 Excel 样本，真实文件验收仍依赖脱敏样本；
- 代码签名证书、真实样本脱敏、Windows 测试机和人工业务验收属于外部成本。
