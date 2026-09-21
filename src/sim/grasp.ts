import { Matrix4, Quaternion, Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Finger, GraspMode, Handedness, Pose, Vec3 } from '../data/types';
import { poseOf, vec3 } from './frames';
import type { ObjectModel } from './objectModel';

/** A hand as the grasp logic sees it: already in the sim (robot-base) frame. */
export interface HandInput {
  handedness: Handedness;
  tracked: boolean;
  tips: Record<Finger, Vector3>;
  tipRadius: Record<Finger, number>;
  wristPosition: Vector3;
  wristQuaternion: Quaternion;
  pinchDistance: number;
}

export interface GraspInfo {
  hand: Handedness;
  mode: GraspMode;
  finger: Finger;
  c1: Vector3;
  c2: Vector3;
  contacts: Partial<Record<Finger, Vector3>>;
  objectPose: Pose;
}

export interface TableRect {
  center: Vec3;
  size: Vec3;
  surfaceZ: number;
}

export type GraspEvent = { type: 'grasp'; info: GraspInfo } | { type: 'release' } | { type: 'dropped' };

const FINGERS: Finger[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const OPPOSING: Finger[] = ['index', 'middle', 'ring', 'pinky'];

interface Contact {
  gap: number;
  point: Vector3;
  normal: Vector3;
}

/**
 * Decides when a hand holds the object, carries it while held, and lets it
 * fall back onto the table when released.
 *
 * A grasp needs the thumb and an opposing finger both touching the surface on
 * roughly opposite faces — the same two-contact grasp the robot's gripper
 * makes, which is what makes the demo usable as a training target. Two fingers
 * resting on the same face do not grasp.
 *
 * While held the object is rigidly welded to the wrist (like the sim's grasp
 * lock); there is no contact physics.
 */
export class GraspController {
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  holder: Handedness | null = null;
  grasp: GraspInfo | null = null;
  /** Fingers currently touching, for highlighting. */
  touching = false;

  private readonly restPose: Pose;
  private readonly offset = new Matrix4();
  private readonly objectMatrix = new Matrix4();
  private readonly inverseObject = new Matrix4();
  private readonly handMatrix = new Matrix4();
  private readonly tmpLocal = new Vector3();
  private readonly unit = new Vector3(1, 1, 1);
  private velocityZ = 0;
  private falling = false;

  constructor(
    private readonly model: ObjectModel,
    rest: Pose,
    private readonly table: TableRect,
  ) {
    this.restPose = rest;
    this.reset();
  }

  reset() {
    this.position.set(...this.restPose.pos);
    this.quaternion.set(
      this.restPose.quat_wxyz[1],
      this.restPose.quat_wxyz[2],
      this.restPose.quat_wxyz[3],
      this.restPose.quat_wxyz[0],
    );
    this.holder = null;
    this.grasp = null;
    this.touching = false;
    this.velocityZ = 0;
    this.falling = false;
  }

  get pose(): Pose {
    return poseOf(this.position, this.quaternion);
  }

  update(dt: number, hands: HandInput[]): GraspEvent[] {
    const events: GraspEvent[] = [];
    this.updateObjectMatrix();

    if (this.holder) {
      const hand = hands.find((h) => h.handedness === this.holder);
      if (hand?.tracked) {
        // Carry first, then test the fingers against where the object now is:
        // testing against last frame's pose would read any fast hand motion as
        // the fingers leaving the surface.
        this.handMatrix.compose(hand.wristPosition, hand.wristQuaternion, this.unit);
        this.objectMatrix.multiplyMatrices(this.handMatrix, this.offset);
        this.objectMatrix.decompose(this.position, this.quaternion, this.tmpLocal);
        this.updateObjectMatrix();
      }
      if (!hand?.tracked || this.shouldRelease(hand)) {
        this.holder = null;
        this.falling = true;
        this.velocityZ = 0;
        events.push({ type: 'release' });
      } else {
        this.touching = true;
        return events;
      }
    }

    if (this.falling && this.fall(dt)) {
      events.push({ type: 'dropped' });
      this.reset();
      return events;
    }

    this.touching = false;
    for (const hand of hands) {
      if (!hand.tracked) continue;
      const info = this.tryGrasp(hand);
      if (info) {
        this.holder = hand.handedness;
        this.grasp = info;
        this.falling = false;
        this.handMatrix.compose(hand.wristPosition, hand.wristQuaternion, this.unit);
        this.offset.copy(this.handMatrix).invert().multiply(this.objectMatrix);
        events.push({ type: 'grasp', info });
        break;
      }
    }
    return events;
  }

  private updateObjectMatrix() {
    this.objectMatrix.compose(this.position, this.quaternion, this.unit);
    this.inverseObject.copy(this.objectMatrix).invert();
  }

  private contact(tip: Vector3, radius: number): Contact {
    const point = new Vector3();
    const normal = new Vector3();
    this.tmpLocal.copy(tip).applyMatrix4(this.inverseObject);
    const distance = this.model.closest(this.tmpLocal, point, normal);
    return { gap: distance - radius, point, normal };
  }

  private tryGrasp(hand: HandInput): GraspInfo | null {
    // Early-out: the whole hand is nowhere near the object.
    this.tmpLocal.copy(hand.tips.thumb).applyMatrix4(this.inverseObject);
    if (this.tmpLocal.length() > this.model.radius + 0.05) return null;

    const contacts = {} as Record<Finger, Contact>;
    for (const f of FINGERS) contacts[f] = this.contact(hand.tips[f], hand.tipRadius[f]);
    const touchingFingers = FINGERS.filter((f) => contacts[f].gap < CONFIG.touchDistance);
    if (touchingFingers.length > 0) this.touching = true;

    const recorded: Partial<Record<Finger, Vector3>> = {};
    for (const f of FINGERS) if (contacts[f].gap < CONFIG.releaseDistance) recorded[f] = contacts[f].point;

    const thumb = contacts.thumb;
    if (thumb.gap < CONFIG.touchDistance) {
      let best: Finger | null = null;
      let bestDot = CONFIG.opposeDot;
      for (const f of OPPOSING) {
        const c = contacts[f];
        if (c.gap >= CONFIG.touchDistance) continue;
        const dot = thumb.normal.dot(c.normal);
        if (dot < bestDot) {
          bestDot = dot;
          best = f;
        }
      }
      if (best) return this.info(hand, 'opposed', best, thumb.point, contacts[best].point, recorded);
    }

    if (CONFIG.allowPinchGrasp && hand.pinchDistance < CONFIG.pinchStartDistance) {
      const mid = new Vector3().addVectors(hand.tips.thumb, hand.tips.index).multiplyScalar(0.5);
      mid.applyMatrix4(this.inverseObject);
      if (this.model.closest(mid) < CONFIG.pinchTouchDistance) {
        return this.info(hand, 'pinch', 'index', thumb.point, contacts.index.point, recorded);
      }
    }
    return null;
  }

  private info(
    hand: HandInput,
    mode: GraspMode,
    finger: Finger,
    c1: Vector3,
    c2: Vector3,
    contacts: Partial<Record<Finger, Vector3>>,
  ): GraspInfo {
    return { hand: hand.handedness, mode, finger, c1, c2, contacts, objectPose: this.pose };
  }

  private shouldRelease(hand: HandInput): boolean {
    const grasp = this.grasp!;
    if (grasp.mode === 'pinch') return hand.pinchDistance > CONFIG.pinchEndDistance;
    const thumb = this.contact(hand.tips.thumb, hand.tipRadius.thumb);
    const other = this.contact(hand.tips[grasp.finger], hand.tipRadius[grasp.finger]);
    return thumb.gap > CONFIG.releaseDistance || other.gap > CONFIG.releaseDistance;
  }

  /** Straight drop onto the table; returns true once it has fallen off it. */
  private fall(dt: number): boolean {
    this.velocityZ -= CONFIG.gravity * dt;
    this.position.z += this.velocityZ * dt;
    this.updateObjectMatrix();

    const { center, size, surfaceZ } = this.table;
    const overTable =
      Math.abs(this.position.x - center[0]) <= size[0] / 2 && Math.abs(this.position.y - center[1]) <= size[1] / 2;
    if (overTable) {
      const lowest = this.model.lowestZ(this.objectMatrix);
      // Land whenever its centre is still above the top — that also pops back up an
      // object released while pressed into the table.
      if (lowest < surfaceZ && this.position.z >= surfaceZ) {
        this.position.z += surfaceZ - lowest;
        this.velocityZ = 0;
        this.falling = false;
        this.updateObjectMatrix();
      }
    }
    return this.position.z < CONFIG.dropZ;
  }
}

export function contactsToVec3(contacts: Partial<Record<Finger, Vector3>>): Partial<Record<Finger, Vec3>> {
  const out: Partial<Record<Finger, Vec3>> = {};
  for (const [finger, p] of Object.entries(contacts) as [Finger, Vector3][]) out[finger] = vec3(p);
  return out;
}
