# AMI-AL Research Framework

> 工业级材料主动学习（Active Learning）优化系统 v2.0
>
> Industrial-Grade Materials Active Learning Optimization System

基于 React + TypeScript + Vite + Express 的 AI4S（AI for Science）原型框架，通过对接 [Materials Project](https://materialsproject.org/) 真实材料数据库，实现贝叶斯优化闭环，加速高性能材料的发现。

---

## 功能特性

- **主动学习闭环**：集成代理模型（Surrogate Model）、获取函数（Acquisition Function）与实验预算管理，支持 UCB / EI / 不确定性采样 / 随机基线等多种策略。
- **真实数据接入**：通过 `/api/materials` 代理接口批量拉取 Materials Project 的锂氧化物（Li-O）材料数据，并自动回退到模拟数据。
- **代价敏感优化**：获取函数按材料的计算代价（原子数、结构复杂度）归一化，优先推荐“单位 DFT 小时价值”更高的候选。
- **多保真特征表示**：13 维材料描述符（10 维成分 + 3 维结构基元），支持同质异构体（polymorph）区分。
- **双语交互界面**：中英文一键切换，内置系统文档、性能基准（Benchmark）与研究方法论说明。
- **双主题皮肤**：经典模式 / 科研蓝模式。
- **本地大模型接入**：通过兼容 OpenAI 协议的代理接口，可配置 DeepSeek / Kimi 等模型作为 AI 对话后端。

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
├── server.ts                          # Express 服务端入口，代理 MP API 与大模型 API
├── vite.config.ts                     # Vite 配置
├── src/
│   ├── App.tsx                        # 主界面与 AL 循环逻辑
│   ├── main.tsx                       # React 挂载
│   ├── types.ts                       # 材料 / AL 状态类型与默认配置
│   ├── components/
│   │   └── BenchmarkSimulator.tsx     # 基准测试弹窗组件
│   ├── engine/
│   │   ├── MaterialsEngine.ts         # 数据加载与特征工程
│   │   ├── SurrogateModel.ts          # 集成回归代理模型
│   │   └── AcquisitionFunction.ts     # UCB / EI / Uncertainty / Random
│   └── services/
│       └── MaterialsProjectService.ts # Materials Project API 封装
├── .env.example                       # 环境变量示例
└── package.json
```

---

## 快速开始

### 前置条件

- Node.js（推荐 18+）
- npm 或兼容包管理器
- DeepSeek / Kimi / 其他兼容 OpenAI 协议的大模型 API Key
- Materials Project API Key

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

应用运行在：http://localhost:3000

---

## 可用脚本

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 启动 Express + Vite 开发服务器 |
| `npm run build` | 构建生产包到 `dist/` |
| `npm run preview` | 预览生产构建 |
| `npm run lint` | 运行 TypeScript 类型检查（`tsc --noEmit`） |
| `npm run clean` | 删除 `dist/` 目录 |

---

## 主动学习工作流

1. **数据加载**：启动时从 `/api/materials?limit=` 拉取 Li-O 材料数据，失败时自动使用 Mock 数据。
2. **初始采样**：随机选取 `INITIAL_SAMPLES`（默认 5）个材料作为种子。
3. **代理模型训练**：使用集成线性回归器拟合已采样数据，输出预测均值 `μ(x)` 与标准差 `σ(x)`。
4. **获取函数计算**：对未采样材料计算 UCB / EI / 不确定性分数。
5. **批量选择**：按获取函数值排序，选取 `BATCH_SIZE`（默认 2）个材料加入已采样集。
6. **状态更新**：记录最佳性能、regret 等指标，进入下一轮迭代。

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

## 后端 API

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

- 当前固定查询 `elements=Li,O`，`_limit` 最大安全上限为 10,000。
- 若未配置 `MP_API_KEY`，返回 `500` 并提示未配置。
- 若 MP API 403，可能是 API Key 不适用于新版 API（v2）或已被限速/封禁。

### `POST /api/chat`

代理调用 DeepSeek（或兼容 OpenAI 协议）的对话补全接口。

**请求体示例**：

```json
{
  "model": "deepseek-chat",
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
  "model": "deepseek-chat",
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

- 默认模型为 `deepseek-chat`。
- 支持通过 `DEEPSEEK_BASE_URL` 切换到其他兼容端点（如 Kimi、本地 vLLM 等）。
- 当前仅支持非流式（`stream: false`）响应。

---

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
- 当前代理模型使用集成线性回归器做演示，生产环境建议替换为高斯过程回归（GPR）或图神经网络（GNN）。
- 结构描述符（晶格畸变、配位数、电负性差异）目前为模拟值，真实场景应从 Materials Project 结构数据或 `matminer` 提取。
- `DISABLE_HMR=true` 可在 AI Studio 等 agent 编辑环境中禁用 HMR，避免文件监听导致的闪烁。

---

## License

MIT
