export const CONFIG = {
  /** Sim z = 0 (table surface) sits this far below the eyes when the task is placed. */
  tableDropFromHead: 0.5,

  // ── Hand tracking ─────────────────────────────────────────────────────────
  /** Keep a hand's last pose this long after Quest drops it for a frame or two. */
  handGraceMs: 150,
  pinchStartDistance: 0.02,
  pinchEndDistance: 0.04,

  // ── Grasping ──────────────────────────────────────────────────────────────
  /** A fingertip touches when its surface gap (minus joint radius) is under this. */
  touchDistance: 0.012,
  /** A held grasp survives until a gripping finger lifts this far off the surface. */
  releaseDistance: 0.03,
  /**
   * Contact normals must point at least this much against each other to count as
   * an opposed grasp (cos of the angle; -0.3 ≈ 107°). Stops two fingers resting
   * on the same face from "grasping".
   */
  opposeDot: -0.3,
  /** Allow a thumb–index pinch at the surface to grab even without opposed normals. */
  allowPinchGrasp: true,
  pinchTouchDistance: 0.015,
  surfaceSamples: 2000,

  // ── Physics after release ─────────────────────────────────────────────────
  gravity: 9.81,
  /** Below this sim z an object has fallen off the table and is respawned. */
  dropZ: -0.6,

  // ── Task ──────────────────────────────────────────────────────────────────
  /** The lift must be held this long to count, so a toss does not succeed. */
  successHoldSeconds: 0.5,
  /** Keep recording this long after success before saving, to capture the hold. */
  saveDelaySeconds: 1.0,
  recordHz: 30,
  maxRecordSeconds: 90,

  // ── UI ────────────────────────────────────────────────────────────────────
  buttonCooldown: 0.35,
  /** After a demo saves, move on to the next case after this long (0 = stay). */
  autoAdvanceSeconds: 2.0,
  /** Chime on success and on save. */
  sound: true,

  colors: {
    primary: 0x4fd1ff,
    object: 0x9fb3c8,
    touched: 0xffd166,
    held: 0x4fd1ff,
    success: 0x5ce08a,
    failure: 0xff5d5d,
    table: 0x8a7056,
    target: 0x5ce08a,
    /** The grasp's two contact points while held. */
    grasp: 0xff5cf0,
  },

  // ── Robot gripper (Franka hand), for the live grip check ─────────────────
  /** Jaw opening range, m (the sim's grasp_width_bounds). */
  robotJawWidth: [0.01, 0.08] as [number, number],
  /** A contact's face may tilt this far from squeezing straight on before the object slips. */
  robotMaxSqueezeAngleDeg: 40,
};
