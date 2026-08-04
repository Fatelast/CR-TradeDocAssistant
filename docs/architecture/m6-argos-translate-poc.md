# M6.0 Argos Translate 本地集成 POC 核验记录

## 结论

M6.0 未通过。当前不实施 Argos Translate 本地翻译集成，也不下载任何模型或变更应用代码。

## 已确认的边界

- 目标语言对仅限俄语（`ru`）到中文（`zh`）。
- 必须使用官方索引中的直译模型。
- 不允许自动或手动配置俄语→英语→中文的中转翻译。
- 译文即使未来生成，也只能作为待人工确认的候选，不能覆盖人工已确认译文。

## 核验依据

- 核验日期：2026-08-03。
- 核验来源：[Argos OpenTech 官方模型索引](https://github.com/argosopentech/argospm-index/blob/main/index.json)。
- 索引当前包含 100 个模型包；不存在同时满足 `from_code=ru` 与 `to_code=zh` 的条目。
- 可见的相关模型只有 `translate-ru_en`（俄语→英语）和 `translate-en_zh`（英语→中文），两者仅能形成英语中转链路。
- Argos Translate 本体是可离线使用的翻译库；本结论针对本项目所需的俄语→中文模型可用性，不否定该库本身的离线能力。参见 [Argos Translate 项目说明](https://github.com/argosopentech/argos-translate)。

## 未执行项

由于硬性闸门未通过，以下工作不执行：

- 不下载 `.argosmodel` 文件，也不把模型写入用户数据目录。
- 不新增 `argostranslate` 依赖，不修改 Worker 打包配置。
- 不创建翻译 Provider、缓存、数据库迁移、IPC 接口或翻译界面。
- 不建立依赖该模型的俄中回归样本集。

## 重新评估条件

满足任一条件后可重新评估：

1. 官方索引出现可下载、可复核许可证的俄语→中文直译模型；
2. 业务明确允许英语中转，并接受其质量、术语与审计风险；
3. 业务授权评估另一个能提供俄语→中文直译模型的本地开源引擎。
