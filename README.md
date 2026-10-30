# AMI-AL Research Framework

> **完整路演模式**：首页默认载入20轮主动学习、白盒公式、三目标前沿、两份MACE收敛构型、XRD对齐结果及研究解读。点击“研究工作台”进入实时工作；“一键路演”随时返回完整成果，原研究会话保留。使用与快照重建见 [路演模式](docs/presentation-mode.md)。

> **统一研究工作台**：候选详情连接 Data Hub、3D、uMLIP、XRD、白盒公式和 AI 顾问；七类目标支持双/三目标寻优与观测回流，配对校准接入预测及公式教师。研究结果可整体保存、导出、恢复，并展示为自己的成果路演。操作见 [统一研究工作流](docs/unified-research.md)，依赖与联合验证见 [整合工作流](docs/integrated-workflows.md)。下文旧版带隙/Mock说明适用于保留的兼容接口。

> 工业级材料主动学习（Active Learning）优化系统 v2.0
>
> Industrial-Grade Materials Active Learning Optimization System

基于 React + TypeScript + Vite + Express 的 AI4S（AI for Science）原型框架，通过对接 [Materials Project](https://materialsproject.org/) 真实材料数据库，实现贝叶斯优化闭环，加速高性能材料的发现。

---

## 功能特性

- **合成预审与 XRD 实验室**：A/B/C 可合成性评级、竞争相提示、当前晶胞的 pymatgen 模拟谱、实验 `.xy` / `.csv` 导入、多相拟合及主动学习反馈；提供一键路演、高纯相与含杂相样例。
- **主动学习闭环**：集成代理模型（Surrogate Model）、获取函数（Acquisition Function）与实验预算管理，支持 UCB / EI / 不确定性采样 / 随机基线等多种策略。
- **七种可选代理模型**：RBF 高斯过程（默认）、随机森林、Extra Trees、梯度提升回归树、kNN、岭回归和 Bootstrap 线性 SGD 基线。训练与批量预测在 Web Worker 中执行，支持取消与固定种子；参数、耗时和不确定性含义在界面展示。
- **白盒物理公式蒸馏**：达到采样门槛后，在独立 Worker 中执行带量纲与定义域检查的符号搜索、L1 筛选和 1–2 项 L0 稀疏模型选择；支持性质拟合、教师蒸馏、组成分组保留测试、公式导出及二维描述符图。详见 [公式蒸馏说明](docs/physical-formula-distillation.md)。
- **真实数据接入**：Data Hub 提供实时/离线 MP、特色观测和配对数据；在线失败读取真实本地快照，空库不生成模拟性质。
- **代价敏感优化**：获取函数按化学式原子计数的启发式成本归一化；该成本不是实测 DFT 耗时。
- **内置元素常数与确定性特征**：离线 JSON 包含118种元素记录；按组成计算电负性、共价/参考离子半径、约定价电子数、原子化学硬度的加权均值、总体方差、极差与覆盖率。真实与 Mock 共用同一提取器，不生成随机物理描述符。
- **组成描述符面板**：实时编辑 composition JSON、查看原始单位统计、常数来源与参考态；满足条件时展示 ABO₃ Goldschmidt 容忍因子。
- **双语交互界面**：中英文一键切换，内置系统文档、性能基准（Benchmark）与研究方法论说明。
- **双主题皮肤**：经典模式 / 科研蓝模式。
- **结构导入与 3D 查看**：在浏览器本地导入 CIF / POSCAR / CONTCAR，检查晶胞、元素占位、周期复制及位点距离；不需要 uMLIP 或 API 密钥。
- **推荐材料结构查看**：点击推荐材料行或化学式，按 Materials Project 材料 ID 获取真实晶胞并缓存；Mock 明确显示“暂无结构”。数据库结构获取需要已有的 `MP_API_KEY`。
- **本地大模型接入**：通过兼容 OpenAI 协议的代理接口，可配置 DeepSeek / Kimi 等模型作为 AI 对话后端。
- **AI 首席材料顾问**：默认 `deepseek-flash`，结合当前轮次、已采样最优材料与 Top-3 候选，支持选材解析、合成/DFT 方案和多轮追问。
- **同成分构型 uMLIP 闭环**：独立的本地 MACE/ASE 固定晶胞弛豫，按真实几何描述符进行 GPR 能量最小化；记录逐步受力、坐标、收敛状态、固定参考相对能和实际耗时。需要额外 Python 运行时和本地权重，不混入带隙标签。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19、TypeScript、Tailwind CSS 4、Recharts、Motion、Lucide React |
| 构建 | Vite 6 |
| 后端 | Express 4、tsx、OpenAI SDK |
| 数据 | Materials Project REST API、axios |

---

## 项目结构

```
AI4S/
├── server.ts                          # 本机服务入口，开发/生产资源与关闭清理
├── server/
│   ├── api.ts                        # 材料与聊天代理、取消、脱敏错误
│   └── network.ts                    # 自动代理、HTTPS CONNECT、超时与有限重试
├── vite.config.ts                     # Vite 配置
├── src/
│   ├── App.tsx                        # 主界面与 AL 循环逻辑
│   ├── main.tsx                       # React 挂载
│   ├── types.ts                       # 材料 / AL 状态类型与默认配置
│   ├── components/
│   │   ├── CompositionDescriptorPanel.tsx # 常数、组成统计与容忍因子
│   │   ├── BenchmarkSimulator.tsx     # 基准测试弹窗组件
│   │   ├── StructurePanel.tsx         # 按需加载与独立错误边界
│   │   ├── StructureWorkspace.tsx     # 本地导入、结构元数据、位点与测距
│   │   └── StructureViewer.tsx        # Three.js 原子、晶胞与几何邻接线
│   ├── structures/                    # 结构类型、Worker、CIF/POSCAR 归一化和周期几何
│   ├── engine/
│   │   ├── ActiveLearningLoop.ts         # 有界单轮采样、预算与停止原因
│   │   ├── MaterialsEngine.ts         # 数据加载与特征工程
│   │   ├── CompositionFeatures.ts     # 统一的22维组成特征
│   │   ├── SeededRandom.ts            # 可复现采样
│   │   ├── SurrogateModel.ts          # 七种回归模型的标准化与统一接口
│   │   ├── ModelWorkerClient.ts       # 任务、取消、超时与隔离的标签边界
│   │   ├── models/                    # RBF GP、CART/森林/GBDT、kNN、Ridge、SGD
│   │   └── AcquisitionFunction.ts     # UCB / EI / Uncertainty / Random
│   └── services/
│       └── MaterialsProjectService.ts # Materials Project API 封装
├── .env.example                       # 环境变量示例
└── package.json
```

---

## 快速开始

合成与 XRD 演示额外需要 Python 3.12。首次运行 `npm run setup:synthesis` 安装独立计算环境；如已有页面占用 3000 端口，可用 `PORT=3001 npm run dev` 启动新工作树。操作流程见 [合成与 XRD 演示指南](docs/synthesis-demo.md)。

### 前置条件

- Node.js 20.19+（20 系列）或 22.12+，与依赖的 Node 要求一致
- npm 或兼容包管理器
- 真实聊天需要 DeepSeek / Kimi / 其他兼容 OpenAI 协议的大模型 API Key
- 真实材料数据需要 Materials Project API Key；没有密钥也可运行 Mock 演示

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制示例文件：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# DeepSeek API Key（兼容 OpenAI 协议）
# 申请地址：https://platform.deepseek.com/api_keys
DEEPSEEK_API_KEY="你的 DeepSeek API Key"

# 可选：自定义 DeepSeek 兼容端点，默认 https://api.deepseek.com/v1
# DEEPSEEK_BASE_URL="https://api.deepseek.com/v1"

# Materials Project API Key，用于后端拉取材料数据
# 申请地址：https://next-gen.materialsproject.org/api
MP_API_KEY="你的 MP API Key"
```

### 3. 启动开发服务器

```bash
npm run dev
```

应用默认仅在本机运行：http://127.0.0.1:3000

并行工作树可指定独立端口：

    PORT=4311 DISABLE_HMR=true npm run dev

### 网络连接（自动处理，无需新增配置）

材料与聊天接口共用同一个网络层。有现成代理环境时自动沿用，没有代理时直连；HTTPS 通过 HTTP 代理时使用 CONNECT，避免旧版 Axios 的重复重定向问题。支持已有 HTTP/HTTPS 与 SOCKS 代理，并遵守 `NO_PROXY` 的域名、端口和通配符规则。设置只从启动进程已有的环境读取，不扫描代理端口、不修改系统代理，也不要求在 `.env` 增加网络选项。

材料 GET 最多重试两次暂时性错误，总请求时间有上限；聊天 POST 和 SDK 都关闭自动重试，避免重复计费。材料加载的整体上限为 60 秒，聊天为 45 秒；客户端断开或更换数据加载时会取消旧请求。代理握手同样有固定超时，正在进行的 SOCKS 握手连接最迟在该次超时内清理。401/403 不重试；较长的 `Retry-After` 会直接提示稍后重试。重定向不会自动携带 API 密钥跳转到其他地址。

无法联网、未配密钥或服务拒绝访问时，页面会明确显示原因和 Mock 标记；模拟数据仍可运行，恢复连接后可点击同步；若已开始模拟迭代，先重置再同步。403 不等于密钥必然错误，也可能涉及权限或网络策略。证书校验始终开启；企业网络需要已有可信证书，项目不会通过关闭 TLS 校验来绕过限制。

这些处理不能保证绕过断网、网络封锁、错误密钥或不可用代理。仅在系统界面启用了代理、但启动进程没有继承对应代理环境的场景，不会自动探测系统专用代理配置。部署为对外服务时还需单独规划认证与访问控制；当前默认仅监听本机。

---

## 可用脚本

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 启动 Express + Vite 开发服务器 |
| `npm run build` | 构建生产包到 `dist/` |
| `npm run preview` | 预览生产构建 |
| `npm run lint` | 运行 TypeScript 类型检查（`tsc --noEmit`） |
| `npm test` | 运行采样、数据、EI 及网络/API回归测试；使用本地模拟服务，不需要真实密钥或上游访问 |
| `npm run clean` | 删除 `dist/` 目录 |
| `npm run benchmark:pareto` | 相同初始样本与预算下，运行8组种子的ParEGO/随机基线对照 |

---

## 主动学习工作流

1. **数据加载**：启动时从 `/api/materials?limit=` 拉取 Li-O 材料数据，失败时自动使用 Mock 数据。
2. **初始采样**：随机选取最多 `INITIAL_SAMPLES`（默认 5）个材料作为种子，数量不超过可用候选与样本预算；空池禁止运行。
3. **代理模型训练**：按选择的模型拟合已采样数据，特征/目标仅按训练集标准化；后台 Worker 输出预测均值 `μ(x)` 与标准差 `σ(x)`。GP 返回潜在函数后验标准差，其它模型返回集成分歧，含义见[模型说明](docs/surrogate-models.md)。
4. **获取函数计算**：对未采样材料计算 UCB / EI / 不确定性分数。
5. **批量选择**：按获取函数值排序，选取最多 `BATCH_SIZE`（默认 2）个材料，受剩余预算与候选数量约束；计数以实际已采样记录为准。
6. **状态更新**：记录最佳性能、regret 等指标，进入下一轮迭代。

样本预算用完或候选耗尽时停止，空池与停止原因会显示在页面中。`MAX_ITERATIONS` 当前仅保留为配置项，不参与停止判断。

每次数据加载均替换整个数据集，只有最新请求可以提交结果。Mock 保留每组成两个演示记录（请求 N 对应 2N 条），现在明确标记为 replica；相同组成的描述符与合成目标完全相同，不再假装随机数能区分多晶型。合成分数为 `χ方差 + 0.05×平均原子硬度 + 0.02×平均约定价电子数`，不是材料带隙。重复加载不累加，不混入此前真实记录。

默认配置见 `src/types.ts`：

```ts
AL_CONFIG = {
  INITIAL_SAMPLES: 5,
  BATCH_SIZE: 2,
  MAX_ITERATIONS: 20,
  TOTAL_BUDGET: 50,
}
```

---

## 内置元素常数与统一描述符

`src/data/element-constants.json` 随前端打包，运行时无需联网获取常数。pymatgen 2025.6.14 与 ASE 的上游提交及数据哈希已固定在 JSON 中；可用 `python3 scripts/build-element-constants.py` 从固定版本重建。第三方数据来源和许可证见 `src/data/NOTICE.md` 与 `src/data/licenses/`。

| 属性 | 定义 / 单位 |
|---|---|
| 电负性 | 鲍林标度，无量纲；来自固定版本 pymatgen 元素表 |
| 共价半径 | Cordero 2008 代表值 / Å（ASE 表）；部分为插值；不导入 ASE 缺值占位符 |
| 参考离子半径 | Shannon 有效离子半径 / Å；每元素明确固定价态、CN6及自旋参考，保留完整价态/配位/自旋记录；不是由组成确定的实际离子 |
| 约定价电子数 | 中性原子构型：主族取最外层s/p，d区再含(n−1)d，f区再含(n−2)f；例如Fe=8、Cu=11、Er=14、Lu=17；这是一项明确的计数约定，不等于氧化态 |
| 原子化学硬度 | η=(第一电离能−电子亲和能)/2 / eV；保留两个原始值；不是氧化物键解离能 |

以原子分数 xᵢ=nᵢ/Σnᵢ 为权重：均值 μ=Σxᵢpᵢ，总体方差 σ²=Σxᵢ(pᵢ−μ)²，极差=max(pᵢ)−min(pᵢ)。同一组成不受键顺序或化学式整体倍数影响。Li₂O 的鲍林电负性均值为1.8，方差为1.3448，极差为2.46。

缺值用 JSON `null` 明确记录。只要任一组成元素缺少某属性，该属性的完整统计就为 `null`，不对剩余元素偷偷重新归一化；同时记录已知原子分数覆盖率。模型用0占位配合覆盖率，面板始终显示缺失。无效组成、负计数和未知元素符号显式拒绝。

每类属性提供均值、方差、极差、覆盖率共4维，5类合计20维；再加容忍因子与有效位，共22维，schema为 `ai4s-composition-1.0.0`。`Material.descriptors` 保留原始单位，`features` 按公开固定尺度缩放（χ:4、共价半径:3 Å、参考离子半径:2 Å、价电子:20、硬度:15 eV；方差用尺度平方，t用2），避免直接用大数值方差破坏线性训练。

容忍因子 t=(rA+rO)/[√2(rB+rO)] 仅对两种阳离子组成的 ABO₃ 比例、参考价态电荷平衡、唯一A/B参考位点和可用半径计算。A用CN12、B用CN6、O²⁻用CN6（1.40 Å）；例如 SrTiO₃ 使用Sr²⁺(1.44 Å)和Ti⁴⁺(0.605 Å)。可向提取器传入明确的 `PerovskiteModel` 来选择价态/自旋。其余组成返回不适用，而非伪造数值。即使给出t，也只是参考ABO₃模型下的几何估算，不证明结构或稳定性；混合位点目前需另行建模。

仅凭composition不能区分同质异构体，也不能得到真实晶格畸变或近邻配位数。原先随机结构特征已删除。应用源码不再调用全局随机数；初始采样、bootstrap、随机策略与示意曲线使用显式固定种子，物理特征本身完全不使用伪随机数。

## 结构导入与 3D 查看

点击页头“结构导入 / 3D”，选择或拖入文件，也可以粘贴文本。查看器提供明确标记的理想 SrTiO3 / NaCl 演示结构，支持旋转、缩放、平移、复位视角、晶胞边框、1×1×1 / 2×2×2 显示、原子选择和两点测距。位点表可以搜索；多数据块 CIF 可以选择要显示的数据块。

- 文件在本地 Web Worker 内解析，不发送到服务端、材料数据库或大模型。保留文件原文、来源文件名、CIF 数据块和占位信息；关闭窗口后保留当前页面会话，刷新页面会清空。
- CIF 1.1：支持常见晶格参数、分数或 Cartesian 坐标、括号不确定度、显式现代/旧式对称操作、特殊位置去重和混占。Cartesian 坐标支持显式变换矩阵和平移；缺少矩阵时采用标准晶胞轴向并提示。对称操作须保持晶格度量。同元素部分占位的等价重叠存在歧义时拒绝自动累加。未提供操作且不能确认为 P1 时，仅显示已列位点并提示未完成对称重建；空间群仅展示文件声明，未进行识别。
- POSCAR / CONTCAR：支持带元素行的 VASP 5 格式、Direct / Cartesian / K 模式、正标量缩放、负体积缩放、三个正 Cartesian 分量缩放和 Selective dynamics。保留 T/F；不读取速度与预测校正附加段。缺元素的 VASP 4 文件不会从标题猜测元素。
- “几何邻接线”只是当前显示坐标的距离截断，不等同于化学键或配位判定；默认截断可调整，最多显示 8000 条。测距同时显示所选周期映像间的直接距离和基于原晶格的最小周期距离，后者包含三斜晶胞处理。
- 当前限制：5 MB、最多 5000 个展开/显示位点、单次解析 10 秒；大于 1200 个显示位点时关闭邻接线。暂不支持 CIF 2.0 和 save frames。对于缺失数值、无效晶胞或无法可靠解释的占位，会提示错误并保留上一份有效结构。

结构使用独立的 `CrystalStructure` 类型，不生成 `trueProperty`，不进入带隙主动学习训练池，也不自动替换22维组成特征。该查看模块只完成输入与显示；如需模型弛豫，使用独立的“uMLIP 构型寻优”工作流。

渲染使用 Three.js（按需加载），CIF 词法/语法读取使用 `crystcif-parse` 的纯解析入口；晶格归一化、对称操作校验、占位处理和周期几何在项目的 `src/structures/` 中实现并有回归测试。

### 从推荐材料查看数据库结构

点击推荐列表中的材料行，或化学式旁的“查看 3D”。列表同步仍只下载性质摘要；点击时才通过后端按该记录的材料 ID 请求 `material_id,formula_pretty,structure,symmetry`，不会按化学式猜测结构。同一化学式下的不同材料 ID 独立缓存。使用数据库返回的完整 pymatgen 晶胞和分数坐标，不再进行对称展开，查看器显示材料 ID、数据源、获取时间及缓存状态。

浏览器会话与本地服务各有 30 分钟内存 LRU 缓存，各自最多 64 项、序列化数据合计 20 MB；过期后重新获取，刷新页面或重启服务分别清空相应缓存。仅成功且通过 ID/几何/占位检查的结构进入缓存。缺少结构、网络失败、认证失败、无效响应及取消的请求不会缓存，页面提供重试。切换材料或关闭查看器会取消旧请求，旧材料的结果不会覆盖当前材料。

Mock 和未确认来源的记录不会发送结构请求，也不会使用演示结构代替，页面显示“暂无结构”。本地文件导入状态独立保留，可从查看器切回。查看数据库结构不会改变带隙主动学习的标签、样本计数、排序或训练数据，也不会自动将其加入 uMLIP 计算池；后者通过独立入口导入同成分构型。

## 代理模型选择与验证

在侧栏“代理模型”中选择模型，展开“模型参数”调整训练种子和相应超参数。开始迭代后参数锁定，需先重置再切换模型。停止、重置、重新加载数据和离开页面均会取消后台计算；旧任务不能覆盖新状态。每项任务最长 30 秒，无同步主线程训练回退。

GPR 使用 RBF 核、Cholesky 分解和训练点距离中位数初始化长度尺度，允许调整尺度倍率和观测噪声；没有自动超参数优化。精确 GPR 最多 256 个训练样本，其它模型最多 1024；最多 128 维特征、每批 20000 个预测。超限会报错，不静默抽样。当前页面预算上限 200，处于 GP 护栏内。候选池数量与训练样本数量不同；没有对所有候选构建完整协方差矩阵。

运行 `npm run benchmark:models` 可输出固定种子、50 个训练样本、1000 个独立合成候选的实际耗时和 RMSE。启动开发服务后打开 `/tests/browser/models.html` 可验证七种真实 Worker、主线程动画、取消和重启。合成数据结果不能作为真实材料精度或发现加速比。

完整实现、参数、复杂度和科学边界见 [docs/surrogate-models.md](docs/surrogate-models.md)。

## 白盒物理公式蒸馏

页头“白盒公式”定位到蒸馏工作区。默认采样达到20条且至少包含8个独立组成后自动搜索；此后每增加10条样本或停止采样后更新。公式卡片显示完整回归方程、系数、单位、发现/选择/测试组成数及误差，并可导出JSON。右侧散点图可一键切换公式坐标，高分区域由当前快照的实际点计算。

“已采样性质”拟合已有标签；“教师预测均值”在隔离的发现组上重训所选教师，并报告对教师的忠实度及对真实性质的误差。Mock合成评分与数据库带隙分开标记。键解离能和几何量可通过有单位、来源及参考定义的JSON补充，模块不生成虚构数据，也不自动运行uMLIP。当前实现是受限符号回归，不等同于完整SISSO/PySR；候选公式和描述符投影不直接构成物理定律、因果或热力学相图证据。

浏览器可打开 /tests/browser/distillation.html 检查真实公式Worker、已知合成关系、教师模式、标签隔离以及取消/重启。

## 多目标帕累托前沿寻优

首页“高性能，也要好生意”面板联合优化功能表现、相稳定性与原料成本。点击“开启协同寻优”，后台 GPR 逐轮运行 ParEGO：重新标量化已观测三目标，按 EI 选择下一候选，并更新非支配前沿与固定尺度超体积。

- **动态前沿**：横轴为功能表现，纵轴为采购成本优势，点色映射 Ehull；连线为三目标前沿的二维投影。演进回放可查看任一历史轮次。
- **企业偏好驾驶舱**：性能旗舰、均衡优选、成本优先及三个滑块即时切换已观测方案，拖动不会增加观测或改写历史。
- **两条数据路线**：96个确定性六金属演示组合；或使用 MP 候选的数据库带隙与 `energy_above_hull`。缺失稳定性或价格的材料单独计数，不以0补齐。
- **原料成本**：按质量分数计算 USD/kg 价格代理。Al/Co/Ni/Cu/Ge/Sc 使用 USGS MCS 2026 中的2025e参考记录；其余预设为可编辑企业情景，逐项保留计量口径和来源。
- **稳定性接入**：支持按材料身份导入已有 MLIP/DFT 相稳定性结果；格式与参考相集合要求见 [docs/pareto-search.md](docs/pareto-search.md)。同成分结构弛豫由 uMLIP 工作台执行，收敛构型可继续进入 XRD 与几何描述符流程。
- **导出**：记录已观测候选、前沿历史、报价、偏好、种子和尺度，不导出未观测目标。

与其他工作树同时演示时，可使用独立端口：

```bash
PORT=3002 DISABLE_HMR=true npm run dev
```

正式路演可先运行 `npm run build`，再用 `NODE_ENV=production PORT=3002 npm run dev` 启动静态构建与后端服务。

详细算法、数据口径与验收项目见 [docs/pareto-search.md](docs/pareto-search.md)。

## 后端 API

### 可选本地 uMLIP 计算工作流

页头“uMLIP 构型寻优”支持导入 2–32 个元素计数、原子数和约束一致的有序晶体。每轮选择尚未计算的构型，实际调用本地 MACE/ASE 弛豫；仅收敛观测进入 GPR，参考能固定为第一个收敛结果。失败或未收敛结果保留但不训练，支持实时进度、坐标查看、取消、POSCAR／轨迹下载和运行恢复。

在被 Git 忽略的 `.env.umlip.local` 中设置 `UMLIP_PYTHON`、`UMLIP_MODEL_PATH`，随后运行 `npm run dev`。不会自动下载权重或回退到模拟能量。`npm run verify:umlip` 执行真实的两轮、四构型验证；`npm test` 不需要 MACE 环境。

计算接口为 `/api/umlip/capabilities`、`/api/umlip/runs` 和 `/api/umlip/runs/:id`，以及取消与输出下载子路径。结果保存在当前工作树的 `umlip-results/`。此模块只预测 MLIP 势能与结构，不提供 DFT 带隙、形成能、凸包距离或迁移势垒。完整依赖、约束、能量定义与溯源格式见 [同成分构型 uMLIP 工作流](docs/umlip-active-learning.md)。

### `GET /api/materials?limit={number}`

代理查询 Materials Project 的锂氧化物摘要数据。

**响应示例**：

```json
{
  "data": [
    {
      "material_id": "mp-1234",
      "formula_pretty": "Li2O",
      "elements": ["Li", "O"],
      "composition": { "Li": 2, "O": 1 },
      "band_gap": 5.8,
      "formation_energy_per_atom": -2.1
    }
  ],
  "meta": { "total_doc": 150 }
}
```

**说明**：

- 当前固定查询 `elements=Li,O`；`limit` 必须是 1–10000 的整数，否则返回 400。
- 若未配置 `MP_API_KEY`，返回 503，错误代码为 `MISSING_API_KEY`。
- 失败返回稳定的 `{error, code, retryable, service}`，可附带 `upstreamStatus`。常见代码包括 `ACCESS_DENIED`、`TIMEOUT`、`PROXY_ERROR`、`DNS_ERROR`、`TLS_ERROR`、`RATE_LIMITED` 和 `REDIRECT_ERROR`，不返回密钥或上游原始错误内容。

### `GET /api/materials/:materialId/structure`

按单个 `mp-…` / `mvc-…` ID 获取结构，兼容数字及新版字母数字 ID；格式无效的 ID 返回 400。密钥只在后端使用，沿用既有自动代理、证书验证、超时及取消处理。成功返回 `{data: {material_id, formula_pretty, structure, symmetry}, meta: {materialId, fetchedAt, cached}}`。缓存策略见上节；无对应结构返回 404 / `STRUCTURE_NOT_FOUND`，失败返回脱敏错误而不会回退为演示结构。

### `POST /api/chat`

代理调用 DeepSeek（或兼容 OpenAI 协议）的对话补全接口。

**请求体示例**：

```json
{
  "model": "deepseek-flash",
  "messages": [
    { "role": "system", "content": "You are a helpful materials science assistant." },
    { "role": "user", "content": "推荐一种带隙大于 6 eV 的锂氧化物" }
  ],
  "temperature": 0.7,
  "max_tokens": 2048
}
```

**响应示例**：

```json
{
  "model": "deepseek-flash",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "..." },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 42, "completion_tokens": 128, "total_tokens": 170 }
}
```

**说明**：

- 默认模型为 `deepseek-flash`。连接官方 DeepSeek Flash 时明确使用 `reasoning_effort: "none"`，适配 45 秒内的非流式交互；其他兼容端点不附加此参数。
- 支持通过 `DEEPSEEK_BASE_URL` 切换到其他兼容端点（如 Kimi、本地 vLLM 等）。
- 当前仅支持非流式（`stream: false`）响应。
- 聊天使用与材料相同的自动代理与超时策略，且不会自动重试 POST；缓冲传输目前仅面向本项目 JSON 聊天，不承诺通用文件上传或 SSE 支持。

---

## AI 首席材料顾问

页头与右下角可以打开顾问窗口。完成一轮主动学习后，Top-3 卡片提供“AI 机理解析”和“DFT 方案”；材料行也有独立的 AI 解析入口，不会触发行点击的 3D 查看器。在窗口内选择材料后，可一键提出合成方案或 DFT 方案，也可自由追问。

- 每次发送捕获当前轮次的快照：数据来源、目标与单位、预算/策略、实际所选代理模型及参数、已采样最优材料、最近一次预测的 Top-3、选中材料的组成、µ/σ/获取分数、估计成本，以及近期最佳已观测值。排序沿用现有获取分数，不额外抽取随机策略；下一轮重训可能改变排序。
- 未采样候选的 `trueProperty`、全局 oracle regret、密钥及结构文件不会发送。真实与 Mock 共用22维确定性组成表示；快照注明特征 schema、元素表版本、缩放除数和缺失常数，不把零占位当作测量值。GP 的 σ 表示潜在函数后验标准差，其它模型的 σ 表示集成分歧；成本为化学式大小的启发式估计。MP 模式分析数据库计算带隙（eV），Mock 模式分析任意单位的合成评分。
- 会话保留在当前页面；发送最近最多 6 轮完整对话及最新快照，自动限制请求体积。每个回答标注快照轮次和来源，当前学习继续迭代时旧回答仍对应旧快照。重置或同步另一批数据会清空会话并取消旧请求；关闭/停止也取消请求，不自动重试付费 POST。
- Markdown 表格、列表与代码块可直接阅读；不执行回答中的 HTML 或自动加载外部图片。合成与计算方案是待验证的研究建议，不会执行计算或修改采样策略。当前未接入文献检索、晶体结构分析或稳定性计算，缺失的晶格、工艺、赝势/U 值依据需继续补充核验。

发送前可展开“查看将发送的数据摘要”。点击发送或快捷分析会把摘要和必要对话发送到已配置的模型服务，不会自动上传整个候选池或本地结构文件。

## 切换其他大模型

由于接口兼容 OpenAI 协议，只需修改 `.env` 即可切换到 Kimi / 本地模型等：

```env
DEEPSEEK_API_KEY="你的 Kimi API Key"
DEEPSEEK_BASE_URL="https://api.moonshot.cn/v1"
```

前端调用时把请求体里的 `model` 改成对应模型 ID，例如 `moonshot-v1-8k`。

---

## 注意事项

- `.env` 文件已加入 `.gitignore`，请勿将真实 API Key 提交到仓库。
- 当前新增七种轻量回归模型；GP 后验依赖核与噪声假设，树间/Bootstrap 分歧不是已校准置信区间。非 GP 的 EI/UCB 为启发式分数。真实材料适用性需要独立留出集、按组成分组的划分及校准测试；未包含 GNN、SVR、MLP、XGBoost 或 LightGBM。
- 元素常数是注明参考约定的原子/离子数据，缺值与条件依赖均保留；真实结构描述符仍需要额外结构输入。策略示意动画不是实测性能基准，不提供加速倍率或预测精度证据。
- `DISABLE_HMR=true` 可在 AI Studio 等 agent 编辑环境中禁用 HMR，避免文件监听导致的闪烁。

---

## License

MIT
