# 脱敏样本目录

此目录存放不含真实客户、供应商、金额、联系方式或报关信息的测试样本。

M1 固定回归样本：

- `m1-standard.xlsx`：非首行表头、合并单元格、冻结窗格、公式，以及已有译文与空译文混合；
- `m1-risky.xlsx`：条件格式和数据验证，用于验证只读受限策略；
- `m1-over-limit.xlsx`：有效数据超过 5,000 行，用于验证稳定的超限错误。

任何真实文件进入仓库前必须完成脱敏和人工复核。

## M5 Beta 轻量验收样本

以下为完全合成的脱敏演示样本，可提交仓库；它们不含真实客户、供应商、金额、联系方式、报关信息或业务编号：

- `m5-beta-basic.xlsx`：基础单工作表和既有译文列；
- `m5-beta-existing-target.xlsx`：非首行表头、已有部分译文和多语言数字混排；
- `m5-beta-multisheet.xlsx`：多工作表、合并标题、冻结窗格、样式和公式；
- `m5-beta-minimal-manifest.json`：三份样本的结构、列映射和 SHA-256 清单。

执行以下命令可完成 Worker 层的导入、人工填写模拟、导出、输出重读和源文件不变性校验：

```powershell
npm run verify:beta-samples
```

仍需在已安装 Excel 或 WPS 的电脑上，任选一个实际导出文件完成一次人工复开；具体步骤见 `docs/testing/m5-release-checklist.md` 的 C.2。该演示集不能替代 V1 的真实样本验收。

## M5 V1 真实文件内测

仓库内固定样本只用于自动化回归，不能替代真实 Office/WPS 验收。真实脱敏文件放入 `resources/private-samples/`，该目录已被 Git 忽略；使用 `m5-regression-manifest.example.json` 复制建立本地清单。

每个样本填写 SHA-256、目标工作表、表头与列映射；`excelResult`、`wpsResult` 仅可填写 `pending`、`pass`、`fail` 或 `not_applicable`。

在 Excel/WPS 人工验收前，先执行只读结构校验：

```powershell
Copy-Item .\resources\samples\m5-regression-manifest.example.json .\resources\private-samples\m5-regression-manifest.json
python .\scripts\verify_regression_manifest.py --manifest .\resources\private-samples\m5-regression-manifest.json
```

已记录为 `fail` 的 Excel/WPS 结果在任何模式下都会阻断校验；当所有样本均已完成验收时，增加 `--strict-office-results`，该模式还会阻止 `pending` 结果被误计为发布通过。

至少覆盖：多工作表、隐藏表、合并单元格、字体字号、行高列宽、冻结窗格、公式、空行、重复原文、已有译文、非首行表头、接近 5,000 行、文件锁、多语言数字混排，以及图表/数据验证/条件格式/外部连接/绘图对象。