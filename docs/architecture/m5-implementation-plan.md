# 中俄贸易文件助手｜M5 实施任务清单

> 状态：M5 工程实现与本机安装验收完成，跨机器和真实样本业务验收待完成  
> 版本：`0.6.0-beta.1`  
> 原则：当前分支继续开发；完全离线；不改变 Worker 协议和 SQLite schema。

## M5.0 基线与发布契约

- [x] 统一根项目、桌面端、共享包和 Worker 为 `0.6.0-beta.1`；
- [x] 固定 Windows 10/11 x64、NSIS 当前用户安装；
- [x] 保持协议 `1.0` 和 schema `3`；
- [x] 增加打包设计、发布门槛和第三方许可说明；
- [ ] 提交并推送 M4—M5 当前基线。

## M5.1 Worker 独立打包

- [x] 增加 PyInstaller 构建依赖和 spec；
- [x] 使用 `onedir + console` 保留 JSON Lines 标准流；
- [x] 实现开发/生产双启动路径；
- [x] 安装模式只执行随包分发的 Worker EXE；
- [x] 强制冻结 Worker 标准流为 UTF-8；
- [x] 将 traceback、ERROR/CRITICAL 和异常退出写入错误日志；
- [x] 增加协议、中文字段和 openpyxl 冻结冒烟测试；
- [x] 在含中文的测试数据路径运行；
- [x] Worker EXE 冒烟测试通过。

## M5.2 Windows 安装包

- [x] 引入 electron-builder；
- [x] 配置 ASAR、Worker `extraResources` 和 NSIS x64；
- [x] 配置当前用户安装、可选目录及卸载保留 AppData；
- [x] 增加应用 PNG/ICO 多尺寸图标；
- [x] 增加固定安装包命名与发布资源校验；
- [x] 增加 SHA-256 生成脚本和 300 MiB 体积门槛；
- [x] 实际生成 NSIS 安装包；
- [x] 验证 `win-unpacked` 内 Worker、ASAR 和许可文件。

## M5.3 自动化与迁移回归

- [x] 增加 Worker 运行时路径单元测试；
- [x] 增加 NSIS 数据保留配置测试；
- [x] 增加 UTF-8 代码页回归测试；
- [x] M4 schema v2→v3 迁移测试继续保留；
- [x] 在完整发布环境执行 `npm run verify:release`；
- [ ] 在安装包中执行导入—审核—导出端到端回归；
- [ ] 使用 schema v2/v3 数据副本完成覆盖升级验证。

## M5.4 真实文件内测

- [x] 将 `resources/private-samples/` 加入 Git 忽略；
- [x] 增加脱敏样本清单模板和验收规范；
- [ ] 补充至少覆盖 16 类场景的脱敏真实 Excel；
- [ ] 在 Microsoft Excel 中完成重开与样式验收；
- [ ] 在 WPS 中完成重开与样式验收；
- [ ] 在 Windows 10 和 Windows 11 干净环境验收；
- [ ] 完成贸易操作人员抽查。

## M5.5 文档与发布

- [x] 编写安装与使用说明；
- [x] 编写发布验收清单；
- [x] 更新 README、启动文档和决策记录；
- [x] 生成 M5 工程知识快照；
- [x] 形成安装包、校验值、版本说明和已知限制；
- [ ] 所有发布门槛通过后升级并标记 `1.0.0`。
