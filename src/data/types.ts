/**
 * Wire formats shared with unitree-grasping.
 *
 * Failure cases are written by `training/vr_failures.py`; demos are written by
 * this app and read back by `scripts/load_vr_demos.py`. Everything is in the
 * robot-base frame: z-up, metres, quaternions as (w, x, y, z).
 */

export type Vec3 = [number, number, number];
export type QuatWXYZ = [number, number, number, number];

export interface Pose {
  pos: Vec3;
  quat_wxyz: QuatWXYZ;
}

export interface FailedAttempt {
  iteration: number;
  /** False for the failure that queued the case, true for each failed replay of it. */
  replay: boolean;
  reward: number;
  reward_terms: Record<string, number>;
  object_pose: Pose;
  grasp: {
    center_local: Vec3;
    width: number;
    contact_left_local: Vec3;
    contact_right_local: Vec3;
  };
}

export interface FailureCase {
  schema: 'unitree-grasp-failure/v1';
  case_id: string;
  run: string;
  created_at: string;
  iteration: number;
  failure_key: {
    shape: string;
    yaw_bin: number;
    yaw_bins: number;
    /** Failed replays it took to export this case. */
    fail_threshold: number;
    queued_at: number;
    queue_entry: number;
  };
  object: {
    shape: string;
    /** Run-relative OBJ path, unscaled; null when training had no mesh for the shape. */
    mesh: string | null;
    mesh_scale: number;
    /** Object-local, already scaled. */
    point_cloud_local: Vec3[];
  };
  object_pose: Pose;
  scene: {
    table: { center: Vec3; size: Vec3; surface_z: number };
    object_scale: number;
    lift_target_m: number;
    gripper_width_bounds?: [number, number];
  };
  task: { type: 'lift'; lift_target_m: number; success_lift_frac: number; description: string };
  failed_attempts: FailedAttempt[];
}

/** A set of cases the menu's SOURCE button can switch to. */
export interface SourceInfo {
  id: string;
  label: string;
  root: string;
  cases: number;
}

/**
 * The demonstrator's judgement of a case: `impossible` when no two-finger
 * gripper could lift it from that pose (too thin, too wide, …), so training
 * stops showing it and evaluation leaves it out. Latest verdict wins.
 */
export type Verdict = 'impossible' | 'feasible';

export interface CaseVerdict {
  schema: 'unitree-grasp-verdict/v1';
  run: string;
  case_id: string;
  shape: string;
  verdict: Verdict;
  created_at: string;
}

export interface CaseSummary {
  source: string;
  run: string;
  case_id: string;
  shape: string;
  yaw_bin: number;
  iteration: number;
  /** Latest verdict saved for this case, if any. */
  verdict: Verdict | null;
  mean_failed_reward: number;
  /** Demos already saved for this case. */
  demos: number;
}

export type Handedness = 'left' | 'right';
export type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export type GraspMode = 'opposed' | 'pinch';

export interface HandFrame {
  /** HAND_JOINTS order, flattened xyz. */
  joints: number[];
  wrist_quat_wxyz: QuatWXYZ;
}

export interface DemoFrame {
  t: number;
  object: Pose;
  held: boolean;
  hands: Record<Handedness, HandFrame | null>;
}

export interface DemoGrasp {
  t: number;
  hand: Handedness;
  mode: GraspMode;
  /** The finger opposing the thumb. */
  finger: Finger;
  /** Thumb contact, object-local (scaled) — same frame as the env's contact_left_local. */
  c1_local: Vec3;
  /** Opposing-finger contact, object-local (scaled). */
  c2_local: Vec3;
  width: number;
  fingertip_contacts_local: Partial<Record<Finger, Vec3>>;
  object_pose: Pose;
}

export interface DemoEvent {
  t: number;
  type: 'grasp' | 'release' | 'success' | 'dropped';
  detail?: string;
}

export interface Demo {
  schema: 'unitree-grasp-demo/v1';
  run: string;
  case_id: string;
  shape: string;
  created_at: string;
  source: 'webxr-hands';
  frame: string;
  success: boolean;
  lift_max_m: number;
  grasp: DemoGrasp | null;
  joint_names: string[];
  events: DemoEvent[];
  frames: DemoFrame[];
  /** The live robot check's verdict, when the check service answered. */
  robot_check?: RobotCheck | null;
}

/**
 * Can the Franka hand grasp at the demo's two points? From unitree-grasping's
 * scripts/grasp_check_server.py: the points run in the sim at the case's exact
 * pose, from whatever approach the robot finds; the demonstrator's hand angle
 * plays no part.
 */
export interface RobotCheck {
  /** Some approach lifted at these points. */
  lifted: boolean;
  /** The approach angles that lifted. */
  lifted_psi_deg: number[];
  noisy_lifts: number;
  noisy_tries: number;
  /** Still lifts at least half the time with the robot's placement error. */
  robust: boolean;
  width_m: number;
  /** Why it cannot work, in plain words; null when it is robust. */
  reason: string | null;
  ms: number;
  /** The robot's best lifting approach at these points; empty when none lifts. */
  attempts?: RobotAttempt[];
}

/** One robot grasp the check executed, in the object's frame (scaled, as the ghost is drawn). */
export interface RobotAttempt {
  psi_deg: number;
  lifted: boolean;
  /** Finger-pad midpoint, after any raise to clear the table. */
  tcp_local: Vec3;
  /** Hand orientation: +Z is the approach, the fingers close along ±Y. */
  quat_local_wxyz: QuatWXYZ;
  width_m: number;
  /** How far the hand was raised so the fingertips clear the table. */
  table_raise_m: number;
}
