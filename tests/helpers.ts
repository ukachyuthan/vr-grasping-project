import fs from 'node:fs';
import path from 'node:path';
import { Quaternion, Vector3 } from 'three';
import type { FailureCase, Finger, Handedness } from '../src/data/types';
import type { HandInput } from '../src/sim/grasp';
import { ObjectModel } from '../src/sim/objectModel';

export const SAMPLE_EVENTS = path.resolve(__dirname, '../sample-events');
export const EXAMPLE = path.join(SAMPLE_EVENTS, 'example');

export function sampleCase(caseId: string): FailureCase {
  return JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'cases', `${caseId}.json`), 'utf-8'));
}

export function sampleModel(c: FailureCase, samples = 3000): ObjectModel {
  const text = fs.readFileSync(path.join(EXAMPLE, c.object.mesh!), 'utf-8');
  return ObjectModel.fromObj(text, c.object.mesh_scale, samples);
}

/**
 * A hand in the sim frame. Fingertips are given explicitly; the rest default
 * to hovering 10 cm above the wrist so they never touch anything.
 */
export function hand(
  handedness: Handedness,
  wrist: Vector3,
  tips: Partial<Record<Finger, Vector3>>,
  tracked = true,
): HandInput {
  const far = wrist.clone().add(new Vector3(0, 0, 0.1));
  const all = {} as Record<Finger, Vector3>;
  const radius = {} as Record<Finger, number>;
  for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky'] as Finger[]) {
    all[f] = (tips[f] ?? far).clone();
    radius[f] = 0.008;
  }
  return {
    handedness,
    tracked,
    tips: all,
    tipRadius: radius,
    wristPosition: wrist.clone(),
    wristQuaternion: new Quaternion(),
    pinchDistance: all.thumb.distanceTo(all.index),
  };
}

/** Moves every point of a hand by `delta`, as if the whole hand were lifted. */
export function shift(h: HandInput, delta: Vector3): HandInput {
  const tips = {} as Record<Finger, Vector3>;
  for (const [f, p] of Object.entries(h.tips) as [Finger, Vector3][]) tips[f] = p.clone().add(delta);
  return { ...h, tips, wristPosition: h.wristPosition.clone().add(delta) };
}
