# 中俄贸易文件助手｜M5 打包工程知识快照

> 当前版本：`0.6.0-beta.1`  
> 当前状态：工程实现与 Windows 11 本机安装链路验收完成，跨机器与真实样本业务验收待完成  
> SQLite schema：`3`  
> Worker 协议：`1.0`

## 1. 阶段结论

M5 已将 Python Worker 从“系统 Python + main.py”改造为随安装包分发的独立进程，并完成 Electron NSIS x64 打包、产物校验、解包运行和 Windows 11 本机安装/卸载验收。开发和生产仍使用相同 JSON Lines 协议；Renderer 无权选择 Worker、数据目录或安装资源路径。

尚不能把当前版本称为 V1 正式完成：仍需在无 Node.js/Python、断网的 Windows 10/11 干净环境，以及 Excel/WPS 和脱敏真实文件上完成外部业务验收。

## 2. 代码地图

- `workers/excel-worker/rus-trade-worker.spec`：PyInstaller onedir 构建契约；
- `workers/excel-worker/requirements-build.txt`：冻结构建依赖；
- `workers/excel-worker/src/main.py`：标准流 UTF-8 固化；
- `apps/desktop/src/main/services/worker-runtime.ts`：开发/生产启动路径；
- `apps/desktop/src/main/services/worker-client.ts`：通用进程配置与 JSON Lines 客户端；
- `apps/desktop/package.json`：electron-builder、NSIS、ASAR、图标和资源配置；
- `scripts/smoke-packaged-worker.mjs`：冻结 Worker 协议与 Excel 冒烟；
- `scripts/verify-release-artifacts.mjs`：安装资源、体积和 SHA-256 校验；
- `resources/icons/`：PNG 与多尺寸 ICO；
- `THIRD_PARTY_NOTICES.md`：随安装包分发的主要第三方许可摘要；
- `resources/licenses/`：Electron、Vue、Vue I18n、openpyxl 和 PyInstaller 许可全文。

## 3. 关键决策

1. Worker 使用 `onedir`，减少单文件临时解压、启动延迟和误报风险；
2. Worker 必须使用 console bootloader，否则 stdin/stdout 可能为空；
3. 生产路径固定为 `process.resourcesPath/worker/rus-trade-worker.exe`；
4. 安装包为 NSIS x64 当前用户安装，卸载保留 AppData；
5. 代码签名、自动更新和在线服务均不进入本阶段；
6. beta 版本通过外部验收后才提升为 `1.0.0`；
7. 安装目录和主程序使用稳定 ASCII 名 `CR-TradeDocAssistant`，产品名、快捷方式和卸载显示保持中文。

## 4. 已验证事实

- PyInstaller `6.21.0` 在 Windows 11、Python 3.12.10 上成功生成 Worker onedir；
- 当前构建机 Worker 目录约 70.13 MiB；
- 冻结 Worker 可完成协议握手和 `m1-standard.xlsx` 解析；
- 已修复冻结 Worker 按 Windows 代码页输出中文导致的协议乱码；
- PNG 为 1024×1024，ICO 包含 16、24、32、48、64、128、256 像素；
- TypeScript 和 ESLint 在 M5 源码改造后通过；
- Worker UTF-8 源码进程回归 2 项通过；
- `npm run verify:release` 完整通过：Worker 23 项、桌面端 10 项、冻结 Worker 冒烟、NSIS 打包和产物校验全部成功；
- 最终安装包为 126,401,819 字节（120.55 MiB），SHA-256 为 `b3d008bfca52976491816d76ccab7fea0271bed21e68d954d68f5114606f0413`；
- 解包版和安装态均正常启动内置 Worker 并创建 schema v3 数据库；
- 安装态退出无残留进程，静默卸载后程序目录/注册项清理完成且隔离业务数据库保留。

## 5. 下一步唯一主线

1. 在无 Node.js/Python、断网的 Windows 10/11 干净机器安装；
2. 使用 schema v2/v3 数据副本执行覆盖升级和重复安装测试；
3. 使用 16 类脱敏真实样本完成 Excel/WPS 重开与样式验收；
4. 由贸易操作人员抽查并记录缺陷；
5. 关闭 P0/P1、补充 P2 规避说明并取得书面验收；
6. 满足全部发布门槛后发布 `1.0.0`。