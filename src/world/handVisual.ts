import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, SphereGeometry } from 'three';
import { CONFIG } from '../config';
import { HAND_JOINTS, type HandTracker } from '../xr/hands';

/**
 * Every tracked joint as a small sphere. Passthrough shows your real hands,
 * but these show what the tracker believes — which is what grasps are decided on.
 */
export class HandVisual {
  readonly mesh: InstancedMesh;
  private readonly dummy = new Object3D();
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);
  private readonly idle = new Color(CONFIG.colors.primary);
  private readonly holding = new Color(CONFIG.colors.success);

  constructor() {
    this.mesh = new InstancedMesh(
      new SphereGeometry(1, 8, 6),
      new MeshBasicMaterial({ transparent: true, opacity: 0.7 }),
      HAND_JOINTS.length * 2,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
  }

  update(hands: HandTracker, holder: 'left' | 'right' | null) {
    let i = 0;
    for (const hand of [hands.left, hands.right]) {
      const color = hand.handedness === holder ? this.holding : this.idle;
      for (const name of HAND_JOINTS) {
        const joint = hand.joint(name);
        if (hand.tracked && joint.valid) {
          this.dummy.position.copy(joint.position);
          this.dummy.scale.setScalar(joint.radius);
          this.dummy.updateMatrix();
          this.mesh.setMatrixAt(i, this.dummy.matrix);
        } else {
          this.mesh.setMatrixAt(i, this.hidden);
        }
        this.mesh.setColorAt(i, color);
        i++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
