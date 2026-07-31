# M5 Windows 内测与 V1 发布验收清单

> 只有本清单全部通过，才允许将 `0.6.0-beta.1` 提升为 `1.0.0`。

## A. 自动化构建

- [x] 根项目、桌面端、共享包和 Worker 版本一致；
- [x] Worker PyInstaller onedir 构建成功；
- [x] 冻结 Worker 协议握手成功；
- [x] 冻结 Worker 可解析固定 Excel 样本；
- [x] 冻结 Worker 中文 JSON Lines 为 UTF-8；
- [x] PNG/ICO 尺寸和 ICO 多分辨率校验通过；
- [x] `npm run verify:release` 全部通过；
- [x] 生成唯一 NSIS x64 安装包；
- [x] `SHA256SUMS.txt` 与安装包一致；
- [x] 安装包小于等于 300 MiB。

## B. 解包结构

- [x] `resources/app.asar` 存在；
- [x] `resources/worker/rus-trade-worker.exe` 存在；
- [x] `resources/worker/_internal` 完整；
- [x] `resources/THIRD_PARTY_NOTICES.md` 存在；
- [x] 直接启动解包应用时 Worker 正常；
- [x] 安装包中没有 Python 源码入口依赖。

## B.1 当前 Windows 11 本机安装验收

- [x] NSIS 当前用户静默安装成功；
- [x] 默认安装目录为 `Programs/CR-TradeDocAssistant`；
- [x] 自定义安装目录成功；
- [x] 桌面和开始菜单快捷方式创建与卸载清理正常；
- [x] 主程序为 Windows GUI 子系统，首次启动无控制台窗口；
- [x] 安装态主进程、渲染进程和内置 Worker 正常；
- [x] 首次启动创建 schema v3 数据库；
- [x] 正常关闭后应用和 Worker 无残留进程；
- [x] 静默卸载成功，注册项和程序目录清理完成；
- [x] 卸载后隔离业务数据库仍保留。

> 本节只代表当前 Windows 11 开发机的安装链路验收，不替代 C、D、E、F 节要求的干净机器、迁移副本、真实 Excel/WPS 和业务签字验收。

## C. 干净机器

分别在 Windows 10 x64、Windows 11 x64 执行：

- [ ] 未安装 Node.js；
- [ ] 未安装 Python；
- [ ] 断开网络；
- [ ] 当前用户安装成功；
- [ ] 自定义安装目录成功；
- [ ] 开始菜单和桌面快捷方式正常；
- [ ] 首次启动无控制台窗口；
- [ ] Worker 状态正常；
- [ ] 可导入、审核和导出固定样本；
- [ ] 退出后无残留 Worker 进程。

## D. 升级、迁移与卸载

- [ ] schema v2 数据副本升级后任务和术语保留；
- [ ] schema v3 数据副本升级后历史、设置和导出审计保留；
- [ ] 同版本重复安装不清空 AppData；
- [ ] beta 覆盖升级不清空 AppData；
- [ ] 卸载后 `userData/data` 仍存在；
- [ ] 卸载后源 Excel 和输出 Excel仍存在；
- [ ] 重新安装后可读取保留的 schema v3 数据；
- [ ] 不支持的降级有明确阻断或说明。

## E. Excel/WPS 真实文件矩阵

- [ ] 单工作表；
- [ ] 多工作表；
- [ ] 隐藏工作表；
- [ ] 合并单元格；
- [ ] 不同字体和字号；
- [ ] 自定义行高和列宽；
- [ ] 冻结窗格；
- [ ] 公式；
- [ ] 空行；
- [ ] 重复原文；
- [ ] 已有部分译文；
- [ ] 表头不在第一行；
- [ ] 接近 5,000 行；
- [ ] 文件被 Excel/WPS 占用；
- [ ] 中文、英文、俄文和数字混排；
- [ ] 图表、数据验证、条件格式、外部连接或绘图对象。

每个样本都要记录：输入 SHA-256、预期字段、预期写回位置、主要样式、Excel 结果、WPS 结果和已知限制。

提交人工验收前，必须对本地清单运行：

```powershell
npm run verify:private-samples -- --strict-office-results
```

该命令只读取 `resources/private-samples/` 中被 Git 忽略的脱敏样本，校验 SHA-256、工作簿结构、表头和列映射；它不替代 Excel/WPS 的人工重开与样式验收。

## F. 发布结论

- [ ] 原文件零覆盖、零损坏；
- [ ] 行映射无严重错误；
- [ ] 编号、数字和日期保护通过；
- [ ] 输出文件可在 Excel/WPS 重新打开；
- [ ] P0 缺陷为 0；
- [ ] P1 缺陷为 0；
- [ ] P2 缺陷有规避说明；
- [ ] 用户手册、版本说明和已知限制完成；
- [ ] 业务验收负责人签字或书面确认。
