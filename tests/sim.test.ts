import fs from 'node:fs';
import path from 'node:path';
import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { DemoSession } from '../src/sim/demo';
import { headingYaw, taskPlacement } from '../src/sim/frames';
import { GraspController } from '../src/sim/grasp';
import { ObjectModel } from '../src/sim/objectModel';
import { EXAMPLE, hand, sampleCase, sampleModel, shift } from './helpers';

const DT = 1 / 60;

describe('frames', () => {
  it('maps sim +x to the gaze and sim +z to world up', () => {
    for (const yaw of [0, 0.7, -2.4]) {
      const head = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      expect(headingYaw(head)).toBeCloseTo(yaw);

      const root = new Group();
      root.matrixAutoUpdate = false;
      taskPlacement(new Vector3(1, 1.1, 2), yaw, root.matrix);
      root.updateMatrixWorld(true);

      const gaze = new Vector3(0, 0, -1).applyQuaternion(head);
      const ahead = root.localToWorld(new Vector3(0.5, 0, 0));
      expect(ahead.distanceTo(new Vector3(1, 1.1, 2).addScaledVector(gaze, 0.5))).toBeLessThan(1e-9);
      const up = root.localToWorld(new Vector3(0, 0, 0.3));
      expect(up.distanceTo(new Vector3(1, 1.4, 2))).toBeLessThan(1e-9);
      // Sim +y (robot's left) is the user's left.
      const left = root.localToWorld(new Vector3(0, 0.2, 0)).sub(new Vector3(1, 1.1, 2));
      expect(left.dot(new Vector3(-1, 0, 0).applyQuaternion(head))).toBeCloseTo(0.2);
    }
  });
});

describe('object model', () => {
  it('samples the OBJ surface at the case scale', () => {
    const c = sampleCase('block__it000101__q1');
    const m = sampleModel(c);
    expect(m.source).toBe('mesh');
    // Block is 6 x 2.5 x 3.5 cm unscaled, ×1.5.
    const p = new Vector3();
    expect(m.closest(new Vector3(0, 0, 0.1), p)).toBeCloseTo(0.1 - 0.02625, 2);
    expect(m.lowestZ(new Matrix4())).toBeCloseTo(-0.02625, 3);
  });

  it('falls back to a hull of the point cloud', () => {
    const c = sampleCase('block__it000101__q1');
    const m = ObjectModel.fromPointCloud(c.object.point_cloud_local, 500);
    expect(m.source).toBe('point-cloud');
    expect(m.radius).toBeGreaterThan(0.04);
  });
});

/** The sample block rests at the origin of a fresh pose for these tests. */
function blockSetup() {
  const c = sampleCase('block__it000101__q1');
  c.object_pose = { pos: [0.5, 0, 0.02625], quat_wxyz: [1, 0, 0, 0] };
  return { c, model: sampleModel(c) };
}

// Block half-extents after scaling: x 4.5 cm, y 1.875 cm, z 2.625 cm.
const center = new Vector3(0.5, 0, 0.02625);
const onFace = (dy: number) => center.clone().add(new Vector3(0, dy, 0));
const wrist = center.clone().add(new Vector3(-0.08, 0, 0.04));

describe('grasp controller', () => {
  it('grasps with thumb and finger on opposite faces', () => {
    const { c, model } = blockSetup();
    const g = new GraspController(model, c.object_pose, { center: [0.5, 0, 0], size: [0.8, 0.6, 0.02], surfaceZ: 0 });
    const events = g.update(DT, [hand('right', wrist, { thumb: onFace(-0.026), index: onFace(0.026) })]);
    expect(events.map((e) => e.type)).toEqual(['grasp']);
    expect(g.grasp!.mode).toBe('opposed');
    expect(g.grasp!.c1.y).toBeCloseTo(-0.01875, 2);
    expect(g.grasp!.c2.y).toBeCloseTo(0.01875, 2);
  });

  it('does not grasp with two fingers on the same face', () => {
    const { c, model } = blockSetup();
    const g = new GraspController(model, c.object_pose, { center: [0.5, 0, 0], size: [0.8, 0.6, 0.02], surfaceZ: 0 });
    const top = (dx: number) => center.clone().add(new Vector3(dx, 0, 0.034));
    expect(g.update(DT, [hand('right', wrist, { thumb: top(-0.03), index: top(0.03) })])).toEqual([]);
    expect(g.touching).toBe(true);
  });

  it('carries the object with the wrist, then drops it back onto the table', () => {
    const { c, model } = blockSetup();
    const g = new GraspController(model, c.object_pose, { center: [0.5, 0, 0], size: [0.8, 0.6, 0.02], surfaceZ: 0 });
    let h = hand('right', wrist, { thumb: onFace(-0.026), index: onFace(0.026) });
    g.update(DT, [h]);
    h = shift(h, new Vector3(0.02, 0.01, 0.1));
    g.update(DT, [h]);
    expect(g.position.distanceTo(center.clone().add(new Vector3(0.02, 0.01, 0.1)))).toBeLessThan(1e-6);

    // Open the hand: fingers move off the faces.
    h = { ...h, tips: { ...h.tips, index: h.tips.index.clone().add(new Vector3(0, 0.05, 0)) } };
    expect(g.update(DT, [h]).map((e) => e.type)).toEqual(['release']);
    for (let i = 0; i < 120; i++) g.update(DT, []);
    expect(g.position.z).toBeCloseTo(0.02625, 3);
    expect(g.position.x).toBeCloseTo(0.52, 6);
  });

  it('respawns an object dropped off the table', () => {
    const { c, model } = blockSetup();
    const g = new GraspController(model, c.object_pose, { center: [0.5, 0, 0], size: [0.8, 0.6, 0.02], surfaceZ: 0 });
    let h = hand('right', wrist, { thumb: onFace(-0.026), index: onFace(0.026) });
    g.update(DT, [h]);
    h = shift(h, new Vector3(0, 0.6, 0.1)); // off the side of the table
    g.update(DT, [h]);
    g.update(DT, [hand('right', wrist, {}, false)]);
    const types = [];
    for (let i = 0; i < 200; i++) types.push(...g.update(DT, []).map((e) => e.type));
    expect(types).toContain('dropped');
    expect(g.position.distanceTo(center)).toBeLessThan(1e-9);
  });
});

describe('demo session', () => {
  it('records a lift and emits one demo after the success hold', () => {
    const { c, model } = blockSetup();
    const session = new DemoSession(c, model);
    let h = hand('left', wrist, { thumb: onFace(-0.026), index: onFace(0.026) });
    const record = () => [{ handedness: 'left' as const, joints: new Float32Array(75), wristQuaternion: new Quaternion() }];

    expect(session.update(DT, [h], record())).toBeNull();
    expect(session.state).toBe('held');

    // Lift past 5 cm, steadily, and keep holding.
    const demos = [];
    for (let i = 0; i < 180; i++) {
      h = shift(h, new Vector3(0, 0, i < 30 ? 0.07 / 30 : 0));
      const d = session.update(DT, [h], record());
      if (d) demos.push(d);
    }
    expect(demos).toHaveLength(1);
    const demo = demos[0];
    expect(session.state).toBe('saving');
    expect(demo.success).toBe(true);
    expect(demo.case_id).toBe(c.case_id);
    expect(demo.lift_max_m).toBeCloseTo(0.07, 3);
    expect(demo.grasp!.mode).toBe('opposed');
    expect(demo.grasp!.width).toBeCloseTo(0.0375, 2);
    expect(demo.events.map((e) => e.type)).toEqual(['grasp', 'success']);
    // 30 Hz for ~1 s of lift+hold+save delay, plus the first frame.
    const expected = (30 / 60 + CONFIG.successHoldSeconds + CONFIG.saveDelaySeconds) * CONFIG.recordHz;
    expect(demo.frames.length).toBeGreaterThan(expected * 0.8);
    expect(demo.frames[0].hands.left!.joints).toHaveLength(75);
  });

  it('does not count a lift that is not held long enough', () => {
    const { c, model } = blockSetup();
    const session = new DemoSession(c, model);
    let h = hand('left', wrist, { thumb: onFace(-0.026), index: onFace(0.026) });
    session.update(DT, [h], []);
    h = shift(h, new Vector3(0, 0, 0.07));
    for (let i = 0; i < 10; i++) session.update(DT, [h], []);
    h = shift(h, new Vector3(0, 0, -0.07));
    for (let i = 0; i < 60; i++) expect(session.update(DT, [h], [])).toBeNull();
    expect(session.state).toBe('held');
  });
});

describe('example scenarios', () => {
  const ids = fs
    .readdirSync(path.join(EXAMPLE, 'cases'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();

  it('ships five', () => {
    expect(ids.map((id) => id.split('__')[0])).toEqual(['block', 'bracket', 'cylinder', 'torus', 'wedge']);
  });

  it.each(ids)('%s rests on the table and settles back after a drop', (id) => {
    const c = sampleCase(id);
    const model = sampleModel(c);
    const session = new DemoSession(c, model);
    const pose = new Matrix4().compose(session.grasp.position, session.grasp.quaternion, new Vector3(1, 1, 1));
    expect(Math.abs(model.lowestZ(pose))).toBeLessThan(0.002);
    expect(c.failed_attempts.map((a) => a.replay)).toEqual([false, true, true, true, true]);

    // Nothing touches it: it must stay put rather than fall through the table.
    for (let i = 0; i < 30; i++) session.update(DT, [], []);
    expect(session.grasp.position.z).toBeCloseTo(c.object_pose.pos[2], 6);
  });
});
