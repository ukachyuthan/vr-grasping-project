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
  Sprite,
  SpriteMaterial,
  CanvasTexture,
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
  /** What to do right now, floating above the object (always faces the viewer). */
  private readonly banner: Sprite;
  private readonly bannerCanvas = document.createElement('canvas');
  private bannerKey = '';

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

    this.bannerCanvas.width = 1024;
    this.bannerCanvas.height = 256;
    this.banner = new Sprite(
      new SpriteMaterial({ map: new CanvasTexture(this.bannerCanvas), transparent: true, depthTest: false }),
    );
    this.banner.scale.set(0.28, 0.07, 1);
    this.banner.position.set(rest[0], rest[1], rest[2] + c.task.lift_target_m + 0.13);
    this.banner.renderOrder = 10;
    this.add(this.banner);

    this.buildGhosts(c);
    this.add(this.ghosts);
    this.setLook('idle');
  }

  /**
   * `reached`: the object is above the target and must be held there; the
   * slab lights up so the demonstrator knows to keep still.
   */
  setLook(look: ObjectLook, reached = false) {
    const color = {
      idle: CONFIG.colors.object,
      touched: CONFIG.colors.touched,
      held: CONFIG.colors.held,
      success: CONFIG.colors.success,
    }[look];
    this.material.color.set(color);
    (this.targetBand.material as MeshBasicMaterial).opacity = look === 'success' ? 0.55 : reached ? 0.45 : 0.18;
  }

  /** Two lines of large text above the object; redrawn only when they change. */
  setBanner(title: string, detail: string, color: number) {
    const key = `${title}|${detail}|${color}`;
    if (key === this.bannerKey) return;
    this.bannerKey = key;
    const ctx = this.bannerCanvas.getContext('2d')!;
    const { width: w, height: h } = this.bannerCanvas;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(3, 8, 13, 0.82)';
    ctx.beginPath();
    ctx.roundRect(8, 8, w - 16, h - 16, 36);
    ctx.fill();
    const hex = `#${color.toString(16).padStart(6, '0')}`;
    ctx.strokeStyle = hex;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = hex;
    ctx.font = 'bold 92px system-ui, sans-serif';
    ctx.fillText(title, w / 2, detail ? 118 : 160);
    if (detail) {
      ctx.fillStyle = '#d8e6f0';
      ctx.font = '56px system-ui, sans-serif';
      ctx.fillText(detail, w / 2, 202);
    }
    (this.banner.material as SpriteMaterial).map!.needsUpdate = true;
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
