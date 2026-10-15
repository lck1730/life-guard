// 把 src/index.js 打成 IIFE 全局包，输出到 static/js/08-room3d.js。
// 08- 前缀让它落在现有拼接管线的最后（static/js/*.js 按文件名顺序拼成 app.js），
// 但这个包是**独立**的全局 Room3D——06-workshop.js 里按需调 Room3D.mount()，
// 不依赖拼接顺序，也不被 app.js 的 IIFE 包裹影响。
import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, '../static/js/08-room3d.js');

const res = await esbuild.build({
  entryPoints: [path.join(root, 'src/index.js')],
  bundle: true,
  format: 'iife',
  globalName: 'Room3D',
  target: ['chrome100', 'safari15', 'firefox100'],
  outfile: out,
  legalComments: 'none',
  logLevel: 'info',
});
// 输出大小，方便判断有没有把 three 整棵塞爆
const size = fs.statSync(out).size;
console.log(`built 08-room3d.js  (${(size / 1024).toFixed(0)} KB)  ${res.warnings.length} warnings`);
