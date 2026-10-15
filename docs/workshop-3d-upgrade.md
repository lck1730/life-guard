# 创意工坊 3D 大升级 · 方案

> 2026-10-15。原始设想见 `data/media/20261015/ea674d65059cd3a96829127b.txt`
> （《交互式手绘卡通卧室 App 整体方案》）。本文是落地版。

## 核心诉求

**画风精致 · 空间感 · 交互式**（拖拽摆件、猫猫自主行为），跑在手机 WebView 里。

## 选型（跟原案的差异）

| 层 | 原案 | 落地 | 理由 |
|---|---|---|---|
| 前端框架 | React + TS + Vite + R3F | **Three.js 原生 + esbuild IIFE 包** | 整个 App 无构建、`static/js/*.js` 按名拼接成 app.js；为一个屏引入 React 构建链不值。IIFE 包落成 `static/js/08-room3d.js`，**部署管线零改动** |
| 美术 | Blender GLB + Mixamo + Substance | **程序化建模**（几何体拼） | 服务器无 Blender/美术/Mixamo；且 `.glb` 二进制 agent 改不了，工坊恰恰是 agent 维护。资产留代码里、agent 能改 |
| 骨骼动画 | AnimationMixer + Mixamo clip | **部件层级 + 程序化变换** | 身/头/尾/爪独立 mesh，尾巴能叠加到任何动作上（正是原案 5.3 要的部件级动画） |
| 状态 | Zustand | 手写 store 或 vendoring | 无 React，zustand 价值减半；M2 再定 |
| 后处理描边 | @react-three/postprocessing Outline | `EdgesGeometry` 线 / BackSide 黑壳 | 不引 EffectComposer，省一层 |

**原案照单全收**（与渲染器无关的好设计）：RoomSlot 白名单、Item 模型、Raycaster 拖拽 + 吸附/回弹、行为树、限定角度 OrbitControls、Toon 材质、移动端性能预算。

## 目录

- 源码：`app/room3d/src/`（进 git），`node_modules` 不进 git
- 构建：`app/room3d/build.mjs` → `app/static/js/08-room3d.js`（构建产物进 git，他本地不用装依赖）
- 自检工具链：`var/room3d-tools/`（puppeteer + chromium，不进 git）

## 自检

headless chromium（swiftshader WebGL）截图。flag：`--use-angle=swiftshader-webgl --enable-unsafe-swiftshader`。
`var/room3d-tools/shot.mjs <url|path> <out.png> [w] [h]`。局限：swiftshader 是软件渲染，性能/抗锯齿跟真机不同，**只验构图和有没有炸**，精细观感仍以他手机截图为准。

## 里程碑

- **M1 静态场景**：toon 卧室（墙/地板/窗/床/床头柜/灯/地毯/猫），软阴影，限定角度 OrbitControls。挂进工坊屏替换 `07-scene.js` 的 SVG。
- **M2 交互**：RoomSlot 白名单、Raycaster 拖拽、吸附/回弹、Hover/Drag/Drop 三态反馈。
- **M3 猫猫生命感**：行为树 idle/walk/jump/sleep，部件动画叠加，点击反馈，自发行为。
- **M4 打磨**：昼夜、更多家具、性能/LOD。

## 部署注意

改了 `app/static/js/` 下文件 → **刷新生效，不用重启**。新增了 `app/room3d/` 源码树和 `08-room3d.js`，**需要同步回本地仓库**，不然下次部署会丢。
