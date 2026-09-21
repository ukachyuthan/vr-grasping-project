import { Quaternion, Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Finger, Handedness } from '../data/types';

export const HAND_JOINTS: XRHandJoint[] = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
];

export const FINGER_TIPS: Record<Finger, XRHandJoint> = {
  thumb: 'thumb-tip',
  index: 'index-finger-tip',
  middle: 'middle-finger-tip',
  ring: 'ring-finger-tip',
  pinky: 'pinky-finger-tip',
};

export interface JointSample {
  position: Vector3;
  radius: number;
  valid: boolean;
}

/** One hand in three.js world space. */
export class HandState {
  tracked = false;
  pinching = false;
  readonly joints = new Map<XRHandJoint, JointSample>();
  readonly wristQuaternion = new Quaternion();
  lastPoseTime = -Infinity;

  constructor(readonly handedness: Handedness) {
    for (const name of HAND_JOINTS) {
      this.joints.set(name, { position: new Vector3(), radius: 0.008, valid: false });
    }
  }

  joint(name: XRHandJoint): JointSample {
    return this.joints.get(name)!;
  }

  get pinchDistance(): number {
    return this.joint('thumb-tip').position.distanceTo(this.joint('index-finger-tip').position);
  }

  invalidate() {
    for (const sample of this.joints.values()) sample.valid = false;
  }
}

/**
 * Reads joint poses straight off the XRFrame (not through three.js' hand
 * wrappers). The wrist's full pose is kept, not just its position: a held
 * object is rigidly attached to it.
 */
export class HandTracker {
  readonly left = new HandState('left');
  readonly right = new HandState('right');

  get(handedness: Handedness): HandState {
    return handedness === 'left' ? this.left : this.right;
  }

  /**
   * Quest drops joint poses for a frame or two when a finger is occluded —
   * common exactly when gripping an object — so a hand keeps its last pose
   * for a short grace window instead of vanishing and dropping what it holds.
   */
  update(frame: XRFrame, refSpace: XRReferenceSpace, time: number) {
    for (const source of frame.session.inputSources) {
      if (!source.hand) continue;
      if (source.handedness !== 'left' && source.handedness !== 'right') continue;
      const state = this.get(source.handedness);
      if (this.readJoints(frame, refSpace, source.hand, state)) state.lastPoseTime = time;
    }

    for (const state of [this.left, this.right]) {
      const wasTracked = state.tracked;
      state.tracked = time - state.lastPoseTime <= CONFIG.handGraceMs;
      if (!state.tracked) {
        if (wasTracked) state.invalidate();
        state.pinching = false;
        continue;
      }
      const d = state.pinchDistance;
      if (!state.pinching && d < CONFIG.pinchStartDistance) state.pinching = true;
      else if (state.pinching && d > CONFIG.pinchEndDistance) state.pinching = false;
    }
  }

  /** True when this frame carried the wrist and thumb/index tips. */
  private readJoints(frame: XRFrame, refSpace: XRReferenceSpace, hand: XRHand, state: HandState): boolean {
    let fresh = 0;
    for (const name of HAND_JOINTS) {
      const space = hand.get(name);
      const pose = space && frame.getJointPose ? frame.getJointPose(space, refSpace) : undefined;
      if (!pose) continue;
      const sample = state.joint(name);
      const p = pose.transform.position;
      sample.position.set(p.x, p.y, p.z);
      sample.radius = pose.radius ?? 0.008;
      sample.valid = true;
      if (name === 'wrist') {
        const o = pose.transform.orientation;
        state.wristQuaternion.set(o.x, o.y, o.z, o.w);
      }
      if (name === 'wrist' || name === 'thumb-tip' || name === 'index-finger-tip') fresh++;
    }
    return fresh === 3;
  }
}
