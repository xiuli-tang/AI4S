# 一键完整路演

首页默认打开完整成果驾驶舱；研究工作台页头的「一键路演」可随时再次载入，也可直接访问 `/?mode=showcase`。视图提供全景、学习与公式、多目标决策、构型/XRD、AI 解读五页。切页与退出不调用聊天或科学计算接口，也不写实验记录与反馈。点击「研究工作台」进入 `/?mode=research`，原研究状态保留；尚未完成的数据加载会重新读取。

## 案例内容

- MP 原始快照的40条材料记录，使用现有 UCB/GPR 数值核心实际完成20轮、24条采样；每轮最佳带隙与完整历史随档案保存。
- 已采样材料上的两项白盒公式，保留分组、测试误差、单位、AST及来源。源码与JSON导出均可复核。
- MP带隙/Ehull/采购价20条评价，8个非支配方案，HV增长31.58646%。性能/均衡/成本偏好和前沿演进可交互。
- 从既有真实MACE运行 `dfce2840-6f79-489e-bb5f-3542af7c48b4` 精选 `demo-0`、`demo-4` 两份收敛结构，保留原运行ID、输入、输出、受力、能量和轨迹。原运行有2轮4条收敛，本展示不改写原运行。
- pymatgen重新计算 SrTiO3 参考结构衍射，再生成与拟合高主相演示谱，保留0.04°偏移、原谱点与拟合数组；图上对理论谱施加匹配偏移以便叠加阅读。
- Codex依据这些结果生成的预置研究解读，可直接阅读和导出；研究模式中的实时顾问继续按原接口运行。

主画面保留「路演快照」「MP数据」「MACE档案」「演示谱」「预置解读」等短标签。计算口径、来源、测试误差与说明收进「ℹ 方法论说明」，错误、输入门槛和服务状态继续直接显示。

## 重新制作存档

使用真实本地MP库、已完成的MACE运行，以及已有科学Python：

```bash
node --import tsx scripts/build-presentation-preset.ts \
  --db /absolute/path/to/ai4s_hub.db \
  --mace-run /absolute/path/to/run.json \
  --python /absolute/path/to/scientific/python
```

脚本只读SQLite和MACE档案，实际执行AL、公式、ParEGO与XRD数值计算，写入 `src/demo/presentation-preset.json`；不下载权重、不发聊天请求。MP筛选与价格记录均保留来源。更新快照后应核对数值、研究解读和测试基准。

## 展示与验证

```bash
npm run lint
npm test
npm run build
NODE_ENV=production PORT=4327 npm run dev
```

按1920×1080检查总览首屏、各页标题、偏好切换、历史截断、三维交互和导出；再检查窄屏整词换行。`PresentationPreset.test.ts` 验证20轮/标签一致性、MACE原始轨迹与固定参考、XRD拟合与演示来源、回放/导出边界及无效档案拒绝。
