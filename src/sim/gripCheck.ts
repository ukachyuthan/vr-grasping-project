import { Vector3 } from 'three';
import { CONFIG } from '../config';
import type { ObjectModel } from './objectModel';

export interface GripCheck {
  /** Jaw width the robot would need, m. */
  width: number;
  /** Worst angle between a contact's surface normal and the jaw line, degrees (0 = squeezing straight on). */
  angle: number;
  ok: boolean;
  /** One short line for the banner. */
  text: string;
}

/**
 * Could the robot's parallel jaw close on these two contacts (object-local)?
 * The same geometric test the robot check reports as its reason: the width
 * within the gripper's opening, and each finger pressing on a face that
 * faces the other finger. Instant, so it runs while the object is held; the
 * sim check after the lift is the real answer.
 */
export function gripCheck(model: ObjectModel, c1: Vector3, c2: Vector3): GripCheck {
  const width = c1.distanceTo(c2);
  const u = new Vector3().subVectors(c2, c1).divideScalar(Math.max(width, 1e-9));
  const n1 = new Vector3();
  const n2 = new Vector3();
  model.closest(c1, undefined, n1);
  model.closest(c2, undefined, n2);
  const deg = (cos: number) => (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
  const angle = Math.max(deg(-n1.dot(u)), deg(n2.dot(u)));

  const [lo, hi] = CONFIG.robotJawWidth;
  const cm = (m: number) => (m * 100).toFixed(1);
  const widthOk = width >= lo && width <= hi;
  const angleOk = angle <= CONFIG.robotMaxSqueezeAngleDeg;
  const parts = [
    widthOk ? `${cm(width)} cm ✓` : width > hi ? `${cm(width)} cm ✗ TOO WIDE (max ${cm(hi)})` : `${cm(width)} cm ✗ TOO NARROW`,
    angleOk ? 'squeeze ✓' : '✗ WILL SLIP: pinch a wall, rim or handle from both sides',
  ];
  return { width, angle, ok: widthOk && angleOk, text: `ROBOT GRIP: ${parts.join(' · ')}` };
}
