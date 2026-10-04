// 鱼群表现：每个"物种 × 深度层"是若干个缓慢游动的群中心，实例围绕群中心做局部偏移和摆动。
// 不做逐鱼邻居搜索，不做接触判定，实例没有独立生物量。
import * as THREE from 'three';
import { FISH, NLAYER, type PoolLayer } from '../sim';
import { allocateInstances, type Allocation } from './instance-budget';
import { TANK, SPECIES_COLOR, mulberry32 } from './common';

const SCALE: Record<string, number> = { A: 0.22, B: 0.22, C: 0.42, D: 0.8 };
const SCHOOLS_PER_CELL: Record<string, number> = { A: 4, B: 4, C: 3, D: 2 };
const SPEED: Record<string, number> = { A: 0.9, B: 0.8, C: 0.6, D: 0.4 };

/** 程序化简单鱼形：身体 + 尾鳍的扁平三角形组合，朝 +x */
function fishGeometry() {
  const v = new Float32Array([
    // 身体（菱形，两个三角）
    1.0, 0, 0,  -0.2, 0.28, 0,  -0.2, -0.28, 0,
    -0.2, 0.28, 0,  -0.7, 0, 0,  -0.2, -0.28, 0,
    // 竖向身体（给侧视一点厚度）
    1.0, 0, 0,  -0.2, 0, 0.16,  -0.7, 0, 0,
    1.0, 0, 0,  -0.7, 0, 0,  -0.2, 0, -0.16,
    // 尾鳍
    -0.65, 0, 0,  -1.05, 0.3, 0,  -1.05, -0.3, 0,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

interface Slot { school: number; off: THREE.Vector3; phase: number; spd: number }

export class FishSchoolView {
  meshes: Record<string, THREE.InstancedMesh> = {};
  alloc: Allocation | null = null;
  budget: number;
  private slots: Record<string, Slot[][]> = {};
  private centers: Record<string, { seed: number; phase: number }[][]> = {};
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(scene: THREE.Scene, budget: number, private layerY: (k: number) => number) {
    this.budget = budget;
    const geo = fishGeometry();
    FISH.forEach((sp, si) => {
      const mat = new THREE.MeshLambertMaterial({ color: SPECIES_COLOR[sp], side: THREE.DoubleSide });
      const mesh = new THREE.InstancedMesh(geo, mat, 1500);
      mesh.count = 0; mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes[sp] = mesh;
      // 布局随机数：每个物种一条有种子的流，和生态核心无关
      const rng = mulberry32(1000 + si * 97);
      this.centers[sp] = Array.from({ length: NLAYER }, () => Array.from({ length: SCHOOLS_PER_CELL[sp] }, () => ({ seed: rng() * 1000, phase: rng() * Math.PI * 2 })));
      this.slots[sp] = Array.from({ length: NLAYER }, () => Array.from({ length: 1500 }, () => {
        const r = Math.cbrt(rng()) * (sp === 'D' ? 2.2 : sp === 'C' ? 1.6 : 1.2);
        const th = rng() * Math.PI * 2, ph = Math.acos(2 * rng() - 1);
        return { school: Math.floor(rng() * SCHOOLS_PER_CELL[sp]), off: new THREE.Vector3(r * Math.sin(ph) * Math.cos(th) * 1.6, r * Math.cos(ph) * .6, r * Math.sin(ph) * Math.sin(th)), phase: rng() * 6.28, spd: .8 + rng() * .4 };
      }));
    });
  }

  setBudget(b: number) { this.budget = b; }

  /** 群中心在层内缓慢游动（Lissajous 路径），只是视觉表现 */
  private center(sp: string, k: number, i: number, t: number, out: THREE.Vector3) {
    const c = this.centers[sp][k][i], w = SPEED[sp] * 0.05;
    out.set(
      Math.sin(t * w + c.seed) * TANK.w * .36,
      this.layerY(k) + Math.sin(t * w * 1.3 + c.phase) * TANK.h / 3 * .28,
      Math.cos(t * w * .7 + c.seed * 1.7) * TANK.d * .32,
    );
    return Math.cos(t * w + c.seed) * TANK.w * .36 * w;   // x 方向速度的符号，用于朝向
  }

  update(X: Readonly<PoolLayer>, time: number, visible: Record<string, boolean>) {
    this.alloc = allocateInstances(X, this.budget, visible);
    FISH.forEach((sp, si) => {
      const mesh = this.meshes[sp];
      let n = 0;
      for (let k = 0; k < NLAYER; k++) {
        const cnt = Math.min(1500, this.alloc!.counts[si][k]);
        for (let j = 0; j < cnt && n < 1500; j++) {
          const sl = this.slots[sp][k][j];
          const vx = this.center(sp, k, sl.school, time, this.v);
          const wig = Math.sin(time * 3 * sl.spd + sl.phase);
          this.v.add(this.s.copy(sl.off).multiplyScalar(1 + .08 * wig));
          this.v.y += Math.sin(time * .8 + sl.phase) * .15;
          this.e.set(0, vx >= 0 ? 0 : Math.PI, wig * .12);
          this.q.setFromEuler(this.e);
          const sc = SCALE[sp];
          this.s.set(sc, sc, sc);
          this.m.compose(this.v, this.q, this.s);
          mesh.setMatrixAt(n++, this.m);
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  totalVisible() { return FISH.reduce((a, sp) => a + this.meshes[sp].count, 0); }
}
