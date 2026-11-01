import { CONFIG } from '../config';
import type { Demo, DemoEvent, DemoFrame, FailureCase, HandFrame, Handedness } from '../data/types';
import { HAND_JOINTS } from '../xr/hands';
import { quatWXYZ, vec3 } from './frames';
import { contactsToVec3, GraspController, type GraspInfo, type HandInput } from './grasp';
import type { ObjectModel } from './objectModel';

export type DemoState = 'ready' | 'held' | 'success' | 'saving' | 'saved' | 'save-failed';

/** A hand's full joint set in the sim frame, for recording. */
export interface HandRecord {
  handedness: Handedness;
  joints: Float32Array | number[];
  wristQuaternion: HandInput['wristQuaternion'];
}

/**
 * One attempt at demonstrating a failure case: the lift task, its success
 * rule, and the recording that becomes the saved demo.
 *
 * Success mirrors the sim's lift reward — the object raised lift_target_m above
 * where it rested — but must be held for a moment so a flick does not count.
 * The demo is emitted once, a short while after success, so the steady hold
 * is part of the recording.
 */
export class DemoSession {
  readonly grasp: GraspController;
  state: DemoState = 'ready';
  liftMax = 0;
  message = '';

  private time = 0;
  private liftHeldFor = 0;
  private successAt = -1;
  /** The grasp that achieved the lift, kept in case the hand lets go before the save. */
  private successGrasp: GraspInfo | null = null;
  private nextFrameAt = 0;
  private frames: DemoFrame[] = [];
  private events: DemoEvent[] = [];
  private readonly restZ: number;
  private readonly liftTarget: number;

  constructor(
    readonly failureCase: FailureCase,
    model: ObjectModel,
  ) {
    const table = failureCase.scene.table;
    this.grasp = new GraspController(model, failureCase.object_pose, {
      center: table.center,
      size: table.size,
      surfaceZ: table.surface_z,
    });
    this.restZ = failureCase.object_pose.pos[2];
    this.liftTarget = failureCase.task.lift_target_m;
    this.reset();
  }

  get lift(): number {
    return this.grasp.position.z - this.restZ;
  }

  /** 0 → 1 while the object is held above the target, before it counts. */
  get holdProgress(): number {
    return Math.min(1, this.liftHeldFor / CONFIG.successHoldSeconds);
  }

  get liftTarget_m(): number {
    return this.liftTarget;
  }

  get liftTargetZ(): number {
    return this.restZ + this.liftTarget;
  }

  reset() {
    this.grasp.reset();
    this.state = 'ready';
    this.liftMax = 0;
    this.time = 0;
    this.liftHeldFor = 0;
    this.successAt = -1;
    this.successGrasp = null;
    this.nextFrameAt = 0;
    this.frames = [];
    this.events = [];
    this.message = 'GRASP IT, LIFT IT';
  }

  /** Called by the app once the POST has landed (or failed); RETRY starts a new take. */
  markSaved(ok: boolean, detail: string) {
    this.state = ok ? 'saved' : 'save-failed';
    this.message = detail;
  }

  /** Still capturing: nothing is recorded once the demo has been handed off. */
  get recording(): boolean {
    return this.state === 'ready' || this.state === 'held' || this.state === 'success';
  }

  /**
   * Advances one frame. Returns the finished demo exactly once, when it is
   * ready to save; the caller owns saving it and reporting back.
   */
  update(dt: number, hands: HandInput[], records: HandRecord[]): Demo | null {
    this.time += dt;
    const t = this.time;

    for (const event of this.grasp.update(dt, hands)) {
      if (event.type === 'grasp') {
        this.events.push({ t, type: 'grasp', detail: `${event.info.hand}:${event.info.mode}:${event.info.finger}` });
        if (this.state === 'ready') this.state = 'held';
      } else if (event.type === 'release') {
        this.events.push({ t, type: 'release' });
        if (this.state === 'held') this.state = 'ready';
        this.liftHeldFor = 0;
      } else {
        this.events.push({ t, type: 'dropped' });
        this.message = 'DROPPED — RESPAWNED';
      }
    }

    const held = this.grasp.holder !== null;
    if (held) this.liftMax = Math.max(this.liftMax, this.lift);

    if (this.state === 'held') {
      this.liftHeldFor = this.lift >= this.liftTarget ? this.liftHeldFor + dt : 0;
      this.message = `LIFT ${(this.lift * 100).toFixed(1)} / ${(this.liftTarget * 100).toFixed(0)} CM`;
      if (this.liftHeldFor >= CONFIG.successHoldSeconds) {
        this.state = 'success';
        this.successAt = t;
        this.successGrasp = this.grasp.grasp;
        this.events.push({ t, type: 'success' });
        this.message = 'SUCCESS — HOLD…';
      }
    }

    // Epsilon: frame times and the sample clock accumulate float error separately.
    if (t + 1e-6 >= this.nextFrameAt && this.recording) {
      this.record(t, held, records);
      this.nextFrameAt = Math.max(this.nextFrameAt + 1 / CONFIG.recordHz, t);
    }

    if (this.state === 'success' && this.successAt >= 0 && t - this.successAt >= CONFIG.saveDelaySeconds) {
      this.state = 'saving';
      this.message = 'SAVING…';
      return this.buildDemo();
    }
    return null;
  }

  private record(t: number, held: boolean, records: HandRecord[]) {
    const hands: Record<Handedness, HandFrame | null> = { left: null, right: null };
    for (const r of records) {
      hands[r.handedness] = {
        joints: Array.from(r.joints, (v) => Math.round(v * 1e5) / 1e5),
        wrist_quat_wxyz: quatWXYZ(r.wristQuaternion),
      };
    }
    this.frames.push({ t: Math.round(t * 1000) / 1000, object: this.grasp.pose, held, hands });
    const maxFrames = CONFIG.maxRecordSeconds * CONFIG.recordHz;
    if (this.frames.length > maxFrames) this.frames.splice(0, this.frames.length - maxFrames);
  }

  private buildDemo(): Demo {
    const c = this.failureCase;
    const g = this.successGrasp ?? this.grasp.grasp;
    // The grasp that achieved the lift is the last one before success.
    const graspEvent = [...this.events].reverse().find((e) => e.type === 'grasp');
    return {
      schema: 'unitree-grasp-demo/v1',
      run: c.run,
      case_id: c.case_id,
      shape: c.object.shape,
      created_at: new Date().toISOString(),
      source: 'webxr-hands',
      frame: 'robot_base: z-up, metres, quaternions wxyz; grasp contacts object-local (scaled)',
      success: true,
      lift_max_m: Math.round(this.liftMax * 1e5) / 1e5,
      grasp: g
        ? {
            t: graspEvent?.t ?? 0,
            hand: g.hand,
            mode: g.mode,
            finger: g.finger,
            c1_local: vec3(g.c1),
            c2_local: vec3(g.c2),
            width: Math.round(g.c1.distanceTo(g.c2) * 1e5) / 1e5,
            fingertip_contacts_local: contactsToVec3(g.contacts),
            object_pose: g.objectPose,
          }
        : null,
      joint_names: HAND_JOINTS,
      events: this.events,
      frames: this.frames,
    };
  }
}
