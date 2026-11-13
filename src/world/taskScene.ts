import {
  BoxGeometry,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Vector3,
} from 'three';
import { CONFIG } from '../config';
import type { FailureCase, RobotAttempt } from '../data/types';
import { applyPose, toQuaternion } from '../sim/frames';
import type { ObjectModel } from '../sim/objectModel';

export type ObjectLook = 'idle' | 'touched' | 'held' | 'success';

/** Banner text wrapped to fit maxWidth; '\n' starts a new line. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * A see-through Franka hand where the robot check put it, in the object's
 * frame: hand +Z is the approach, the fingers close along ±Y onto the pads at
 * the tcp. Rough proportions; it shows how the robot would take the points.
 */
function gripperGhost(a: RobotAttempt, color: number): Group {
  const material = new MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthTest: false });
  const hand = new Group();
  const half = a.width_m / 2;
  for (const side of [1, -1]) {
    const finger = new Mesh(new BoxGeometry(0.0175, 0.008, 0.05), material);
    finger.position.set(0, side * (half + 0.004), -0.015);
    hand.add(finger);
  }
  const palm = new Mesh(new BoxGeometry(0.05, Math.max(0.2, a.width_m + 0.04), 0.05), material);
  palm.position.set(0, 0, -0.065);
  hand.add(palm);
  const approach = new Line(
    new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, -0.25)]),
    new LineBasicMaterial({ color, transparent: true, depthTest: false }),
  );
  hand.add(approach);
  hand.position.set(...a.tcp_local);
  hand.quaternion.copy(toQuaternion(a.quat_local_wxyz));
  hand.traverse((o) => (o.renderOrder = 5));
  return hand;
}

/**
 * Everything drawn for one case, authored in sim coordinates (the parent is
 * the task root, which handles the z-up swap and placement).
 */
export class TaskScene extends Group {
  readonly object = new Group();
  /** The robot check's gripper(s), on a ghost of the object at its rest pose (the ROBOT button). */
  readonly ghosts = new Group();
  private readonly material = new MeshStandardMaterial({ color: CONFIG.colors.object, roughness: 0.6 });
  private readonly targetBand: Mesh;
  /** What to do right now, floating above the object (always faces the viewer). */
  private readonly banner: Sprite;
  private readonly bannerCanvas = document.createElement('canvas');
  private bannerKey = '';
  /** The two points the robot gets (thumb, opposing finger), on the object while it is held. */
  private readonly graspPoints = new Group();
  private readonly graspMaterial = new MeshBasicMaterial({ color: CONFIG.colors.grasp, depthTest: false });
  private readonly graspLine: Line;
  private attemptsKey = '';

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

    for (let i = 0; i < 2; i++) {
      const s = new Mesh(new SphereGeometry(0.006, 16, 12), this.graspMaterial);
      s.renderOrder = 6;
      this.graspPoints.add(s);
    }
    this.graspLine = new Line(
      new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
      new LineBasicMaterial({ color: CONFIG.colors.grasp, depthTest: false }),
    );
    this.graspLine.renderOrder = 6;
    this.graspPoints.add(this.graspLine);
    this.graspPoints.visible = false;
    this.object.add(this.graspPoints);

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

    applyPose(c.object_pose, this.ghosts);
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

  /**
   * Marks the grasp's two contacts (object-local) and the jaw line between
   * them, coloured by whether the robot's gripper could close there; null hides them.
   */
  setGraspPoints(c1: Vector3 | null, c2: Vector3 | null, color: number = CONFIG.colors.grasp) {
    this.graspPoints.visible = !!(c1 && c2);
    if (!c1 || !c2) return;
    const [a, b] = this.graspPoints.children as Mesh[];
    a.position.copy(c1);
    b.position.copy(c2);
    this.graspLine.geometry.setFromPoints([c1, c2]);
    this.graspMaterial.color.set(color);
    (this.graspLine.material as LineBasicMaterial).color.set(color);
  }

  /**
   * Large text above the object: a title, then the detail wrapped over as many
   * lines as it needs ('\n' starts a new line). Redrawn only when it changes.
   */
  setBanner(title: string, detail: string, color: number) {
    const key = `${title}|${detail}|${color}`;
    if (key === this.bannerKey) return;
    this.bannerKey = key;
    const ctx = this.bannerCanvas.getContext('2d')!;
    const w = this.bannerCanvas.width;
    ctx.font = '52px system-ui, sans-serif';
    const lines = detail ? wrapText(ctx, detail, w - 80) : [];
    const h = 170 + 64 * lines.length;
    if (this.bannerCanvas.height !== h) {
      this.bannerCanvas.height = h;
      // Same text size whatever the line count: the sprite grows upward with the canvas.
      const scaleY = 0.28 * (h / w);
      this.banner.position.z += (scaleY - this.banner.scale.y) / 2;
      this.banner.scale.set(0.28, scaleY, 1);
      (this.banner.material as SpriteMaterial).map!.dispose();
      (this.banner.material as SpriteMaterial).map = new CanvasTexture(this.bannerCanvas);
    }
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(3, 8, 13, 0.85)';
    ctx.beginPath();
    ctx.roundRect(8, 8, w - 16, h - 16, 36);
    ctx.fill();
    const hex = `#${color.toString(16).padStart(6, '0')}`;
    ctx.strokeStyle = hex;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = hex;
    ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.fillText(title, w / 2, lines.length ? 110 : h / 2 + 30);
    ctx.fillStyle = '#d8e6f0';
    ctx.font = '52px system-ui, sans-serif';
    lines.forEach((line, i) => ctx.fillText(line, w / 2, 180 + 64 * i));
    (this.banner.material as SpriteMaterial).map!.needsUpdate = true;
  }

  /** The robot check's approach(es) at the grasp points, drawn in `color`; null clears them. */
  setRobotAttempts(attempts: RobotAttempt[] | null, color: number = CONFIG.colors.success) {
    const key = `${JSON.stringify(attempts)}|${color}`;
    if (key === this.attemptsKey) return;
    this.attemptsKey = key;
    for (const child of [...this.ghosts.children]) {
      this.ghosts.remove(child);
      child.traverse((o) => (o as Mesh).geometry?.dispose());
    }
    for (const a of attempts ?? []) this.ghosts.add(gripperGhost(a, color));
  }
}
