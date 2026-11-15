import * as THREE from 'three';
import { geometryOf } from '../catalog';
import type { MeshArrays } from '../types';

export function toGeometry(m: MeshArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
  g.setAttribute('aMeta', new THREE.BufferAttribute(m.meta, 2));
  if (m.params.length) g.setAttribute('aParams', new THREE.BufferAttribute(m.params, 4));
  if (m.index) g.setIndex(new THREE.BufferAttribute(m.index, 1));
  // Shadow normal bias needs finite normals even though shading is faceted from screen derivatives.
  g.computeVertexNormals();
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

export function triangles(g: THREE.BufferGeometry) { return (g.index ? g.index.count : g.getAttribute('position').count) / 3; }

const archetypeGeometry = new Map<string, THREE.BufferGeometry>();
export function geometryFor(id: string, lod: number) {
  const key = `${id}/${lod}`;
  let g = archetypeGeometry.get(key);
  if (!g) { g = toGeometry(geometryOf(id, lod)); archetypeGeometry.set(key, g); }
  return g;
}
export function disposeArchetypeGeometry() { for (const g of archetypeGeometry.values()) g.dispose(); archetypeGeometry.clear(); }
