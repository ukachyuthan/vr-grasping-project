import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { gripCheck } from '../src/sim/gripCheck';
import { sampleCase, sampleModel } from './helpers';

// The sample block scaled ×1.5: 9.0 × 3.75 × 5.25 cm, centred on the origin.
const block = sampleModel(sampleCase('block__it000101__q1'));

describe('gripCheck', () => {
  it('accepts a squeeze across the narrow faces', () => {
    const g = gripCheck(block, new Vector3(0, -0.01875, 0), new Vector3(0, 0.01875, 0));
    expect(g.ok).toBe(true);
    expect(g.width).toBeCloseTo(0.0375, 3);
    expect(g.text).toContain('3.8 cm ✓');
  });

  it('rejects the long axis as wider than the jaw opens', () => {
    const g = gripCheck(block, new Vector3(-0.045, 0, 0), new Vector3(0.045, 0, 0));
    expect(g.ok).toBe(false);
    expect(g.text).toContain('TOO WIDE');
  });

  it('rejects two contacts on the same face', () => {
    const g = gripCheck(block, new Vector3(-0.02, 0.01875, 0), new Vector3(0.02, 0.01875, 0));
    expect(g.ok).toBe(false);
    expect(g.text).toContain('WILL SLIP');
  });
});
