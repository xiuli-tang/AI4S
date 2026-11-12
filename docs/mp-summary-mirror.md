# Materials Project Summary 全量镜像

全量 Summary 保存在服务器，网页仍按筛选条件载入候选。原始 Parquet 保留全部列；独立 SQLite 索引提供应用所需的组成、结构、带隙、形成能和凸包上能量。无需 MP API Key，也不依赖访问者的电脑提供后端。

## 下载与建索引

Python 3.11+ 只用于一次性下载和转换。网页查询使用已有的 `better-sqlite3`，不常驻 Python 数据进程。

```bash
python3 -m venv .venv-mp-summary
.venv-mp-summary/bin/pip install -r requirements-mp-summary.txt
python3 scripts/download-mp-summary.py \
  --url 'https://materialsproject-build.s3.amazonaws.com/collections/summary/version%3D2026-09-28/part-00000-2cc5f2cc-2a79-4051-b013-2f9dec6a302e-c000.zstd.parquet' \
  --version 2026-09-28 --expected-bytes 414503512 \
  --output-dir data/mp-summary/2026-09-28
.venv-mp-summary/bin/python scripts/index-mp-summary.py \
  --snapshot-dir data/mp-summary/2026-09-28 \
  --output data/mp-summary/summary.sqlite \
  --elements src/data/element-constants.json
AI4S_MP_SUMMARY_DB="$PWD/data/mp-summary/summary.sqlite" npm run dev
```

下载验证远端字节数、ETag与Parquet首尾标识，记录SHA256和获取时间。中断可续传；转换再次验证SHA256，并以64条批次读取。建库在临时文件完成，记录数核对和SQLite完整性检查通过后才发布索引。原始快照、索引及转换环境均不提交Git。

## 网页查询与兼容

在 Data Hub 选择“离线 MP”，填写包含元素、排除元素和体系匹配方式。界面分别显示完整快照条数、当前有效材料数、符合目标的匹配数量以及本次载入数。读取上限为1–5000，默认2000条，仅限制当前候选池，筛选覆盖全库。候选按材料ID排序截取；列表传输性质及结构指纹，完整晶胞按精确版本加载。

停用记录默认不参与筛选。缺失或无效目标值不填0；无法通过晶格、占位和组成校验的结构不进入结构工作流，原始文件仍保留。转换报告列出原始、索引、停用、无效结构和拒绝记录的数量。

选中的记录才写入原有 Hub 工作缓存，保留完整来源、快照版本、单位、任务ID、稳定的获取时间及精确 revision。结构、XRD、uMLIP派生参考和研究存档继续读取原有精确版本缓存。替换全量索引不会删除旧版本；迁移已有研究时应同时备份 Hub 数据库与索引。

实时 MP 成功结果保持原行为；在线失败时才使用全量离线索引。未设置 `AI4S_MP_SUMMARY_DB` 的部署仍使用原有小规模离线库。

## 验证

```bash
python3 -m unittest discover -s tests -p test_mp_summary_index.py
npm test
npm run lint
npm run build
git diff --check
```

官方来源：[AWS OpenData](https://docs.materialsproject.org/downloading-data/aws-opendata)。镜像是指定版本的 Summary，不包含全部 MP 详细计算文件；原 Materials Project 使用条款适用。
