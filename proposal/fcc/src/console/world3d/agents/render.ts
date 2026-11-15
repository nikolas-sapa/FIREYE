import * as THREE from 'three';
import { ARCHETYPE } from '../catalog';
import type { WorldMaterialSet } from '../render/materials';
import { geometryFor } from '../render/geometry';
import { AGENT_ID_BASE, SPECIES, type AgentSim, type Species } from './sim';

const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

/** One shared InstancedMesh per species; every view draws the same agents. */
export class AgentMeshes {
  readonly group = new THREE.Group();
  private meshes = new Map<Species, THREE.InstancedMesh>();
  private capacity = new Map<Species, number>();
  visible = 0;

  constructor(private materials: WorldMaterialSet) { this.group.name = 'agents'; this.group.matrixAutoUpdate = false; }

  private mesh(sp: Species, need: number) {
    let mesh = this.meshes.get(sp);
    if (mesh && (this.capacity.get(sp) ?? 0) >= need) return mesh;
    if (mesh) { this.group.remove(mesh); mesh.dispose(); }
    const cap = Math.max(16, 1 << Math.ceil(Math.log2(need + 1)));
    mesh = new THREE.InstancedMesh(geometryFor(sp, 0), this.materials.get('agent'), cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.castShadow = ARCHETYPE.get(sp)?.shadow ?? true; mesh.receiveShadow = true;
    mesh.customDepthMaterial = this.materials.depth('agent');
    mesh.count = 0;
    this.meshes.set(sp, mesh); this.capacity.set(sp, cap); this.group.add(mesh);
    return mesh;
  }

  write(sim: AgentSim, alpha: number) {
    const counts = new Map<Species, number>();
    for (const a of sim.agents) if (a.visible) counts.set(a.species, (counts.get(a.species) ?? 0) + 1);
    this.visible = 0;
    for (const sp of SPECIES) {
      const n = counts.get(sp) ?? 0;
      if (!n && !this.meshes.has(sp)) continue;
      const mesh = this.mesh(sp, n);
      const M = mesh.instanceMatrix.array as Float32Array, C = mesh.instanceColor!.array as Float32Array;
      const cls = ARCHETYPE.get(sp)!.cls;
      let k = 0;
      for (const a of sim.agents) {
        if (a.species !== sp || !a.visible) continue;
        let dh = a.heading - a.pheading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        p.set(a.px + (a.x - a.px) * alpha, a.py + (a.y - a.py) * alpha, a.pz + (a.z - a.pz) * alpha);
        q.setFromAxisAngle(up, a.pheading + dh * alpha);
        s.setScalar(a.scale);
        m.compose(p, q, s);
        const e = m.elements;
        e[3] = a.pphase + (a.phase - a.pphase) * alpha;
        e[7] = sp === 'bird' ? 1 : Math.min(1, a.speed / 1.2);
        e[11] = cls;
        e[15] = AGENT_ID_BASE + a.index;
        M.set(e, k * 16);
        C[k * 3] = a.tint[0]; C[k * 3 + 1] = a.tint[1]; C[k * 3 + 2] = a.tint[2];
        k++;
      }
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true;
      this.visible += k;
    }
  }

  dispose() { for (const mesh of this.meshes.values()) mesh.dispose(); this.meshes.clear(); }
}
