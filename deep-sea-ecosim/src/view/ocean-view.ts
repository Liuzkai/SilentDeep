// 三层水体的 3D 视图。只读生态状态，不写回任何生态量。
// 渲染随机数使用独立的有种子流，和生态核心完全隔离。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LAYER_DEPTHS, type PoolLayer } from '../sim';
import { FishSchoolView } from './fish-school-view';
import { SPECIES_COLOR, TANK, mulberry32 } from './common';

export class OceanView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  schools: FishSchoolView;
  private boundaries: THREE.Group;
  private labels: { el: HTMLElement; pos: THREE.Vector3 }[] = [];
  private resource: THREE.Points;
  private resourceMax = 900;

  constructor(private host: HTMLElement, private overlay: HTMLElement, budget: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setClearColor(0x050b14);
    host.appendChild(this.renderer.domElement);
    this.scene.fog = new THREE.Fog(0x050b14, 30, 70);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.position.set(21, 6, 25);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 12; this.controls.maxDistance = 80;

    this.scene.add(new THREE.AmbientLight(0x8fb4d8, 0.9));
    const dl = new THREE.DirectionalLight(0xbfd9ff, 0.8); dl.position.set(5, 20, 10); this.scene.add(dl);

    // 水体外框
    const box = new THREE.BoxGeometry(TANK.w, TANK.h, TANK.d);
    this.scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x3d5a73 })));
    const water = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x0a2236, transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false }));
    this.scene.add(water);

    // 层边界平面
    this.boundaries = new THREE.Group();
    for (const y of [TANK.h / 6, -TANK.h / 6]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(TANK.w, TANK.d), new THREE.MeshBasicMaterial({ color: 0x4f7ea6, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
      plane.rotation.x = -Math.PI / 2; plane.position.y = y;
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(TANK.w, TANK.d)), new THREE.LineBasicMaterial({ color: 0x4f7ea6 }));
      edge.rotation.x = -Math.PI / 2; edge.position.y = y;
      this.boundaries.add(plane, edge);
    }
    this.scene.add(this.boundaries);

    // 深度标尺：左前竖边的刻度线 + HTML 标签
    const ticks = new THREE.Group();
    const tickMat = new THREE.LineBasicMaterial({ color: 0x8aa7c0 });
    for (let d = 600; d <= 1500; d += 100) {
      const y = this.depthToY(d), len = d % 300 === 0 ? 1.0 : 0.5;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-TANK.w / 2, y, TANK.d / 2), new THREE.Vector3(-TANK.w / 2 - len, y, TANK.d / 2)]);
      ticks.add(new THREE.Line(g, tickMat));
      if (d % 300 === 0) this.addLabel(`${d} m`, new THREE.Vector3(-TANK.w / 2 - 1.3, y, TANK.d / 2), 'depth');
    }
    this.scene.add(ticks);
    LAYER_DEPTHS.forEach(([a, b], k) => this.addLabel(`L${k + 1}  ${a}–${b} m`, new THREE.Vector3(TANK.w / 2 + 0.6, this.depthToY((a + b) / 2), TANK.d / 2), 'layer'));

    // 基础饵料 R：每层一团淡色点，密度对应 R 生物量（同样是抽样表现）
    const pos = new Float32Array(this.resourceMax * 3 * 3);
    const rng = mulberry32(7);
    for (let k = 0; k < 3; k++) for (let n = 0; n < this.resourceMax; n++) {
      const o = (k * this.resourceMax + n) * 3;
      pos[o] = (rng() - .5) * TANK.w * .96; pos[o + 1] = this.layerY(k) + (rng() - .5) * TANK.h / 3 * .92; pos[o + 2] = (rng() - .5) * TANK.d * .96;
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.resource = new THREE.Points(rg, new THREE.PointsMaterial({ color: SPECIES_COLOR.R, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false }));
    this.scene.add(this.resource);

    this.schools = new FishSchoolView(this.scene, budget, k => this.layerY(k));
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  depthToY(d: number) { return TANK.h / 2 - (d - 600) / 900 * TANK.h; }
  layerY(k: number) { return TANK.h / 3 - k * TANK.h / 3; }

  private addLabel(text: string, at: THREE.Vector3, cls: string) {
    const el = document.createElement('div'); el.className = `label3d ${cls}`; el.textContent = text;
    this.overlay.appendChild(el); this.labels.push({ el, pos: at });
  }

  setBoundaries(v: boolean) { this.boundaries.visible = v; }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
  }

  /** 每帧渲染：X 是只读快照 */
  render(X: Readonly<PoolLayer>, time: number, visible: Record<string, boolean>) {
    // R：按生物量决定每层画多少个点（固定 BU/点，不归一化）
    const perPoint = 0.4;
    const idx: number[] = [];
    for (let k = 0; k < 3; k++) {
      const n = visible.R === false ? 0 : Math.min(this.resourceMax, Math.floor(X[0][k] / perPoint));
      for (let i = 0; i < n; i++) idx.push(k * this.resourceMax + i);
    }
    this.resource.geometry.setIndex(idx);
    this.schools.update(X, time, visible);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const w = this.host.clientWidth, h = this.host.clientHeight;
    for (const { el, pos } of this.labels) {
      const p = pos.clone().project(this.camera);
      el.style.transform = `translate(${(p.x * .5 + .5) * w}px, ${(-p.y * .5 + .5) * h}px) translate(-50%, -50%)`;
      el.style.display = p.z < 1 ? '' : 'none';
    }
  }
}
