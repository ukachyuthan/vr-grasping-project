import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { CONFIG } from '../config';
import type { FailureCase } from '../data/types';
import { applyPose } from '../sim/frames';
import type { ObjectModel } from '../sim/objectModel';

export type ObjectLook = 'idle' | 'touched' | 'held' | 'success';

/**
 * Everything drawn for one case, authored in sim coordinates (the parent is
 * the task root, which handles the z-up swap and placement).
 */
export class TaskScene extends Group {
  readonly object = new Group();
  /** The robot's failed attempts, drawn on a ghost of the object at its rest pose. */
  readonly ghosts = new Group();
  private readonly material = new MeshStandardMaterial({ color: CONFIG.colors.object, roughness: 0.6 });
  private readonly targetBand: Mesh;

  constructor(c: FailureCase, model: ObjectModel) {
    super();
    const { table } = c.scene;

    const tableMesh = new Mesh(
      new BoxGeometry(...table.size),
      new MeshStandardMaterial({ color: CONFIG.colors.table, roughness: 0.9, transparent: true, opacity: 0.9 }),
    );
    tableMesh.position.set(...table.center);
    this.add(tableMesh);

    this.object.add(new Mesh(model.geometry, this.material));
    this.add(this.object);

    // Where the object has to get to: a translucent slab at rest height + lift target.
    const rest = c.object_pose.pos;
    this.targetBand = new Mesh(
      new BoxGeometry(0.16, 0.16, 0.002),
      new MeshBasicMaterial({ color: CONFIG.colors.target, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    this.targetBand.position.set(rest[0], rest[1], rest[2] + c.task.lift_target_m);
    this.add(this.targetBand);

    this.buildGhosts(c);
    this.add(this.ghosts);
    this.setLook('idle');
  }

  setLook(look: ObjectLook) {
    const color = {
      idle: CONFIG.colors.object,
      touched: CONFIG.colors.touched,
      held: CONFIG.colors.held,
      success: CONFIG.colors.success,
    }[look];
    this.material.color.set(color);
    (this.targetBand.material as MeshBasicMaterial).opacity = look === 'success' ? 0.4 : 0.18;
  }

  private buildGhosts(c: FailureCase) {
    applyPose(c.object_pose, this.ghosts);

    const cloud = new BufferGeometry();
    cloud.setAttribute('position', new Float32BufferAttribute(c.object.point_cloud_local.flat(), 3));
    this.ghosts.add(new Points(cloud, new PointsMaterial({ color: 0xffffff, size: 0.003, transparent: true, opacity: 0.5 })));

    const n = c.failed_attempts.length;
    c.failed_attempts.forEach((attempt, i) => {
      // Older attempts fade, so the latest failure reads first.
      const color = new Color(CONFIG.colors.failure).multiplyScalar(0.45 + (0.55 * (i + 1)) / n);
      const sphere = new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false });
      const a = new Vector3(...attempt.grasp.contact_left_local);
      const b = new Vector3(...attempt.grasp.contact_right_local);
      for (const p of [a, b]) {
        const s = new Mesh(new SphereGeometry(0.004, 12, 8), sphere);
        s.position.copy(p);
        s.renderOrder = 5;
        this.ghosts.add(s);
      }
      const jaw = new Line(
        new BufferGeometry().setFromPoints([a, b]),
        new LineBasicMaterial({ color, transparent: true, depthTest: false }),
      );
      jaw.renderOrder = 5;
      this.ghosts.add(jaw);
    });
  }
}
