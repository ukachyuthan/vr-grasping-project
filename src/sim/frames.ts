import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { Pose, QuatWXYZ, Vec3 } from '../data/types';

/**
 * The robot-base frame the dataset uses is z-up, with the robot at the origin
 * looking along +x. three.js is y-up. Every task object lives under one "task
 * root" whose matrix does both jobs: it swaps the axes, and it places the
 * robot's origin where the user stands, with +x along their gaze.
 *
 * Because of that, anything parented to the task root is authored in plain
 * sim coordinates, and `taskRoot.worldToLocal()` turns a tracked hand joint
 * straight into the frame the training code uses.
 */
const Z_UP_TO_Y_UP = new Matrix4().makeRotationX(-Math.PI / 2);
const UP = new Vector3(0, 1, 0);

/**
 * Task-root matrix: sim origin at `origin` (three world coordinates), sim +x
 * pointing along heading `yaw` — the rotation about +y of a camera, so yaw 0
 * looks down -z.
 */
export function taskPlacement(origin: Vector3, yaw: number, target = new Matrix4()): Matrix4 {
  // R_y(θ) sends +x to (cos θ, 0, -sin θ); the gaze at yaw is (-sin yaw, 0, -cos yaw).
  const turn = new Matrix4().makeRotationAxis(UP, yaw + Math.PI / 2);
  return target.makeTranslation(origin.x, origin.y, origin.z).multiply(turn).multiply(Z_UP_TO_Y_UP);
}

/** Heading of a head orientation about world +y, ignoring pitch and roll. */
export function headingYaw(q: Quaternion): number {
  const forward = new Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-forward.x, -forward.z);
}

export function vec3(v: Vector3): Vec3 {
  return [round(v.x), round(v.y), round(v.z)];
}

export function quatWXYZ(q: Quaternion): QuatWXYZ {
  return [round(q.w), round(q.x), round(q.y), round(q.z)];
}

export function toQuaternion(q: QuatWXYZ, target = new Quaternion()): Quaternion {
  return target.set(q[1], q[2], q[3], q[0]).normalize();
}

export function applyPose(pose: Pose, object: Object3D) {
  object.position.set(...pose.pos);
  toQuaternion(pose.quat_wxyz, object.quaternion);
}

export function poseOf(position: Vector3, quaternion: Quaternion): Pose {
  return { pos: vec3(position), quat_wxyz: quatWXYZ(quaternion) };
}

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
