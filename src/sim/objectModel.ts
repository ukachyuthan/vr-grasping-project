import { BufferAttribute, BufferGeometry, Matrix4, Mesh, Vector3 } from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import type { Vec3 } from '../data/types';

/**
 * An object's geometry in its own (sim, scaled) frame, plus a dense surface
 * sample used for every contact query.
 *
 * Contacts are measured against surface samples rather than the triangles: it
 * is brute force, but at ~2000 points and five fingertips per hand that is a
 * few thousand distance checks a frame, and it works identically for a mesh
 * and for the point-cloud fallback. Samples carry their face normal, which is
 * what the opposed-grasp test compares.
 */
export class ObjectModel {
  readonly samples: Float32Array;
  readonly normals: Float32Array;
  readonly count: number;
  /** Bounding radius about the local origin, for a cheap early-out. */
  readonly radius: number;

  private readonly tmp = new Vector3();

  constructor(
    readonly geometry: BufferGeometry,
    sampleCount: number,
    readonly source: 'mesh' | 'point-cloud',
  ) {
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const sampler = new MeshSurfaceSampler(new Mesh(geometry)).build();
    this.count = sampleCount;
    this.samples = new Float32Array(sampleCount * 3);
    this.normals = new Float32Array(sampleCount * 3);
    const p = new Vector3();
    const n = new Vector3();
    let radius = 0;
    for (let i = 0; i < sampleCount; i++) {
      sampler.sample(p, n);
      p.toArray(this.samples, i * 3);
      n.normalize().toArray(this.normals, i * 3);
      radius = Math.max(radius, p.length());
    }
    this.radius = radius;
  }

  /** OBJ text in the dataset's unscaled frame; `scale` is the case's mesh_scale. */
  static fromObj(text: string, scale: number, sampleCount: number): ObjectModel {
    const group = new OBJLoader().parse(text);
    const chunks: Float32Array[] = [];
    group.updateMatrixWorld(true);
    group.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(
        mesh.matrixWorld,
      );
      chunks.push(g.getAttribute('position').array as Float32Array);
    });
    if (chunks.length === 0) throw new Error('OBJ contains no meshes');

    const positions = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      positions.set(c, offset);
      offset += c.length;
    }
    for (let i = 0; i < positions.length; i++) positions[i] *= scale;

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    return new ObjectModel(geometry, sampleCount, 'mesh');
  }

  /**
   * Convex hull of the case's point cloud, for shapes training had no mesh for.
   * Concave objects lose their hollows — a torus becomes a disc — so the app
   * flags this on the menu.
   */
  static fromPointCloud(points: Vec3[], sampleCount: number): ObjectModel {
    const geometry = new ConvexGeometry(points.map((p) => new Vector3(...p)));
    return new ObjectModel(geometry, sampleCount, 'point-cloud');
  }

  /**
   * Nearest surface sample to a point in object-local coordinates. Writes its
   * position and normal when targets are given; returns the distance.
   */
  closest(local: Vector3, outPoint?: Vector3, outNormal?: Vector3): number {
    let best = Infinity;
    let bestIndex = 0;
    const s = this.samples;
    for (let i = 0; i < this.count; i++) {
      const dx = s[i * 3] - local.x;
      const dy = s[i * 3 + 1] - local.y;
      const dz = s[i * 3 + 2] - local.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) {
        best = d;
        bestIndex = i;
      }
    }
    outPoint?.fromArray(s, bestIndex * 3);
    outNormal?.fromArray(this.normals, bestIndex * 3);
    return Math.sqrt(best);
  }

  /** Lowest z of the surface once placed by `objectToSim`, i.e. where it meets the table. */
  lowestZ(objectToSim: Matrix4): number {
    let lowest = Infinity;
    for (let i = 0; i < this.count; i++) {
      this.tmp.fromArray(this.samples, i * 3).applyMatrix4(objectToSim);
      if (this.tmp.z < lowest) lowest = this.tmp.z;
    }
    return lowest;
  }
}
