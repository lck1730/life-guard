// 创意工坊 3D 卧室 —— M1 静态场景。
// Three.js 原生（无 React）。暴露全局 Room3D.mount(container, opts) / unmount()。
// 画风：Toon 材质（分段渐变）+ 边线描边 + 暖光 + 软阴影，3/4 俯视、限定角度 OrbitControls。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ── 调色板（暖色卡通）─────────────────────────────────────────────
const C = {
  sky: 0xbfe3f0, floor: 0xc89a5e, floorDark: 0xb07f44,
  wall: 0xe9d6ad, wallTrim: 0xd9b87e,
  bedFrame: 0x7a4a28, mattress: 0xf3ead6, blanket: 0xb8512f, pillow: 0xfff2df,
  stand: 0x8a5638, shade: 0xffcf7a, lampMetal: 0x3a3a3a,
  rug: 0xb23b30, rugTrim: 0xf0d8a8,
  cat: 0xe0894a, catBelly: 0xf3ddc4, catEar: 0xe0a0a0, eye: 0x6fae5a, dark: 0x2b2b2b,
  winPane: 0xbfe0ef, winFrame: 0xffffff,
  leaf: 0x6fae5a, pot: 0xb06a3a,
};
const LINE = 0x33302a; // 描边色（偏暖的深褐，不是死黑）

// Toon 分段渐变贴图：4 个台阶，nearest 过滤 → 硬边色阶
function makeToonGradient() {
  const t = new Uint8Array([60, 140, 200, 255]);
  const tex = new THREE.DataTexture(t, 4, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const TOON = makeToonGradient();
function toon(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: TOON, ...opts });
}

// 带描边的盒子：本体 + EdgesGeometry 线段。pos 是组的位置。
function box(w, h, d, color, pos, rot, matOpts) {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, toon(color, matOpts));
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 30),
    new THREE.LineBasicMaterial({ color: LINE })
  );
  g.add(edges);
  if (pos) g.position.set(...pos);
  if (rot) g.rotation.set(...rot);
  return g;
}

// ── 房间：地板 + 两面墙（L 角）────────────────────────────────────
function buildRoom(scene) {
  const ROOM = 8;       // 内净 8×8
  const H = 3.2;        // 墙高

  // 地板：用两块拼出木纹方向感（深浅交替条）——这里简单两色双条
  const floor = box(ROOM, 0.2, ROOM, C.floor, [0, -0.1, 0]);
  floor.receiveShadow = true;
  scene.add(floor);
  // 地板条纹（视觉纹理，贴地）
  for (let i = -3; i <= 3; i += 2) {
    const stripe = box(ROOM, 0.21, 0.25, C.floorDark, [0, 0, i]);
    stripe.children.forEach(c => { c.receiveShadow = true; });
    scene.add(stripe);
  }

  // 后墙（z = -ROOM/2）
  scene.add(box(ROOM, H, 0.2, C.wall, [0, H / 2, -ROOM / 2]));
  // 左墙（x = -ROOM/2）
  scene.add(box(0.2, H, ROOM, C.wall, [-ROOM / 2, H / 2, 0]));
  // 踢脚线
  scene.add(box(ROOM, 0.18, 0.22, C.wallTrim, [0, 0.09, -ROOM / 2 + 0.11]));
  scene.add(box(0.22, 0.18, ROOM, C.wallTrim, [-ROOM / 2 + 0.11, 0.09, 0]));

  // 窗户：后墙中部，外透冷光
  const wx = 0, wy = 1.7, wz = -ROOM / 2 + 0.12;
  scene.add(box(2.2, 1.5, 0.08, C.winPane, [wx, wy, wz], null,
    { transparent: true, opacity: 0.55 }));                       // 玻璃
  scene.add(box(2.5, 0.12, 0.1, C.winFrame, [wx, wy + 0.82, wz])); // 上框
  scene.add(box(2.5, 0.12, 0.1, C.winFrame, [wx, wy - 0.82, wz])); // 下框
  scene.add(box(0.12, 1.7, 0.1, C.winFrame, [wx - 1.2, wy, wz]));  // 左框
  scene.add(box(0.12, 1.7, 0.1, C.winFrame, [wx + 1.2, wy, wz]));  // 右框
  scene.add(box(0.08, 1.7, 0.08, C.winFrame, [wx, wy, wz]));       // 中梃

  // 窗外冷光（白天感）+ 暖台灯 —— 见 lights
}

// ── 床 ────────────────────────────────────────────────────────────
function buildBed(scene) {
  const g = new THREE.Group();
  g.position.set(-1.6, 0, 0.4);
  // 床架
  g.add(box(2.4, 0.5, 3.2, C.bedFrame, [0, 0.25, 0]));
  // 床头板
  g.add(box(2.4, 1.1, 0.18, C.bedFrame, [0, 0.8, -1.5]));
  // 床垫
  g.add(box(2.2, 0.35, 3.0, C.mattress, [0, 0.62, 0.05]));
  // 被子（盖住下半，露出枕头区）
  g.add(box(2.24, 0.2, 1.9, C.blanket, [0, 0.78, 0.6]));
  // 枕头
  g.add(box(0.9, 0.22, 0.6, C.pillow, [-0.5, 0.82, -1.0]));
  g.add(box(0.9, 0.22, 0.6, C.pillow, [0.5, 0.82, -1.0]));
  scene.add(g);
  return g;
}

// ── 床头柜 + 台灯 ──────────────────────────────────────────────────
function buildNightstand(scene) {
  const g = new THREE.Group();
  g.position.set(-3.3, 0, 0.4);
  g.add(box(1.0, 0.9, 1.0, C.stand, [0, 0.45, 0]));
  g.add(box(1.02, 0.12, 1.02, C.wallTrim, [0, 0.92, 0], null,
    { color: C.winFrame })); // 柜面亮条
  // 台灯：底座 + 杆 + 灯罩（自发光暖色）
  g.add(box(0.28, 0.08, 0.28, C.lampMetal, [0, 0.96, 0]));
  g.add(box(0.06, 0.4, 0.06, C.lampMetal, [0, 1.2, 0]));
  const shade = box(0.5, 0.3, 0.5, C.shade, [0, 1.5, 0], null,
    { emissive: 0xffb050, emissiveIntensity: 0.8 });
  g.add(shade);
  // 灯发光点
  const lampLight = new THREE.PointLight(0xffc878, 1.2, 6, 2);
  lampLight.position.set(0, 1.5, 0);
  g.add(lampLight);
  scene.add(g);
  return g;
}

// ── 地毯 ──────────────────────────────────────────────────────────
function buildRug(scene) {
  const g = box(3.2, 0.04, 2.2, C.rug, [0.6, 0.02, 1.6]);
  scene.add(g);
  scene.add(box(3.0, 0.05, 2.0, C.rugTrim, [0.6, 0.03, 1.6], null,
    { transparent: true, opacity: 0.9 }));
}

// ── 绿植（角落点缀，强化空间感）──────────────────────────────────
function buildPlant(scene) {
  const g = new THREE.Group();
  g.position.set(3.3, 0, -3.0);
  g.add(box(0.7, 0.6, 0.7, C.pot, [0, 0.3, 0]));
  // 几片叶子（扁圆柱/锥）
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 1.0, 5),
      toon(C.leaf)
    );
    leaf.position.set(Math.cos(i) * 0.2, 1.1, Math.sin(i) * 0.2);
    leaf.rotation.z = Math.cos(i) * 0.5;
    leaf.rotation.x = Math.sin(i) * 0.5;
    leaf.castShadow = true;
    g.add(leaf);
  }
  scene.add(g);
}

// ── 猫（程序化，部件分组，为 M3 行为树预留）──────────────────────
function buildCat(scene) {
  const cat = new THREE.Group();
  cat.position.set(0.6, 0.0, 1.6);   // 坐在地毯上
  cat.rotation.y = -0.6;

  const bodyMat = toon(C.cat), bellyMat = toon(C.catBelly);
  // 身体（坐姿：椭球）
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 16), bodyMat);
  body.scale.set(1, 1.1, 1.15);
  body.position.set(0, 0.5, 0);
  body.castShadow = true;
  cat.add(body);
  // 肚皮
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), bellyMat);
  belly.scale.set(1, 1.0, 0.6);
  belly.position.set(0, 0.42, 0.28);
  cat.add(belly);
  // 头
  const head = new THREE.Group();
  head.position.set(0, 0.95, 0.05);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), bodyMat);
  skull.castShadow = true; head.add(skull);
  // 耳朵
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 4), bodyMat);
    ear.position.set(sx * 0.16, 0.28, 0);
    ear.rotation.x = Math.PI;
    head.add(ear);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), toon(C.catEar));
    inner.position.set(sx * 0.16, 0.24, 0.02);
    inner.rotation.x = Math.PI;
    head.add(inner);
  }
  // 眼睛
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), toon(C.eye, { emissive: 0x223311, emissiveIntensity: 0.1 }));
    eye.position.set(sx * 0.1, 0.02, 0.27);
    head.add(eye);
  }
  // 鼻子
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), toon(C.dark));
  nose.position.set(0, -0.05, 0.3);
  head.add(nose);
  cat.add(head);
  // 前腿（坐姿并拢）
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.5, 10), bodyMat);
    leg.position.set(sx * 0.14, 0.2, 0.28);
    leg.castShadow = true; cat.add(leg);
  }
  // 尾巴：沿曲线的管，绕到身前（坐姿）—— TubeGeometry
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.45, -0.35),
    new THREE.Vector3(0.25, 0.4, -0.5),
    new THREE.Vector3(0.45, 0.45, -0.3),
    new THREE.Vector3(0.5, 0.55, 0.0),
  ]);
  const tail = new THREE.Mesh(
    new THREE.TubeGeometry(tailCurve, 20, 0.08, 8, false),
    bodyMat
  );
  tail.castShadow = true;
  cat.add(tail);

  // 给 M3 留部件引用
  cat.userData = { body, head, tail };
  scene.add(cat);
  return cat;
}

// ── 光照 ──────────────────────────────────────────────────────────
function buildLights(scene) {
  scene.add(new THREE.HemisphereLight(0xfff5e6, 0x6b5a44, 0.65));

  const sun = new THREE.DirectionalLight(0xfff8e7, 1.0);
  sun.position.set(5, 7, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 25;
  sun.shadow.camera.left = -6; sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  sun.target.position.set(0, 0, 0);
  scene.add(sun.target);

  // 窗外冷补光
  const win = new THREE.PointLight(0xd4e5ff, 0.5, 12, 2);
  win.position.set(0, 1.7, -4.5);
  scene.add(win);
}

// ── mount / unmount ──────────────────────────────────────────────
let state = null;

export function mount(container, _opts = {}) {
  if (state) unmount();
  const w = container.clientWidth || 414;
  const h = container.clientHeight || 600;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.sky);

  const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 100);
  camera.position.set(4.6, 3.4, 5.4);
  camera.lookAt(0, 0.8, 0);

  const renderer = new THREE.WebGLRenderer({
    antialias: true, alpha: false,
    preserveDrawingBuffer: !!_opts.preserveDrawingBuffer, // 自检时开，否则 readPixels 读到空
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.8, 0);
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxDistance = 11;
  controls.minPolarAngle = Math.PI / 4;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minAzimuthAngle = -Math.PI / 4;
  controls.maxAzimuthAngle = Math.PI / 4;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.update();

  buildLights(scene);
  buildRoom(scene);
  buildRug(scene);
  buildBed(scene);
  buildNightstand(scene);
  buildPlant(scene);
  const cat = buildCat(scene);

  // 单指旋转、双指缩放（触屏）
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  let raf = 0;
  function tick() {
    // M3 之前猫不动；这里留个钩子
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  tick();

  function onResize() {
    const nw = container.clientWidth, nh = container.clientHeight;
    if (!nw || !nh) return;
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh);
  }
  const ro = new ResizeObserver(onResize);
  ro.observe(container);

  state = { renderer, scene, camera, controls, ro, raf, cat };
  return state;
}

export function unmount() {
  if (!state) return;
  cancelAnimationFrame(state.raf);
  state.ro.disconnect();
  state.controls.dispose();
  state.renderer.dispose();
  if (state.renderer.domElement.parentNode) {
    state.renderer.domElement.parentNode.removeChild(state.renderer.domElement);
  }
  state.scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
      else o.material.dispose();
    }
  });
  state = null;
}
