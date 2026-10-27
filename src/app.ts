import {
  AmbientLight,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CONFIG } from './config';
import { fetchCase, fetchCases, fetchMesh, fetchSources, saveDemo, saveVerdict } from './data/client';
import type { CaseSummary, Demo, Finger, SourceInfo } from './data/types';
import { DemoSession, type HandRecord } from './sim/demo';
import { headingYaw, taskPlacement } from './sim/frames';
import type { HandInput } from './sim/grasp';
import { ObjectModel } from './sim/objectModel';
import { Panel } from './ui/panel';
import { HandVisual } from './world/handVisual';
import { TaskScene } from './world/taskScene';
import { FINGER_TIPS, HAND_JOINTS, type HandState, HandTracker } from './xr/hands';

const FINGERS = Object.keys(FINGER_TIPS) as Finger[];
/** Where the menu sits, in sim coordinates: beside the table's left edge, above it. */
const PANEL_SIM = new Vector3(0.3, 0.42, 0.22);
/** Desktop preview stands in for a head at this height. */
const DESKTOP_HEAD = new Vector3(0, 1.6, 0);

export type Command = 'source' | 'prev' | 'next' | 'reset' | 'ghosts' | 'recenter' | 'impossible';

export class App {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.01, 50);
  /** Status for the desktop overlay; the headset reads the panel instead. */
  onStatus: (lines: string[]) => void = () => {};

  /** Parent of every task object; its matrix maps sim (z-up) coordinates into the room. */
  private readonly taskRoot = new Group();
  private readonly hands = new HandTracker();
  private readonly handVisual = new HandVisual();
  private readonly panel: Panel;

  private sources: SourceInfo[] = [];
  private sourceIndex = 0;
  private cases: CaseSummary[] = [];
  private index = 0;
  private session: DemoSession | null = null;
  private taskScene: TaskScene | null = null;
  private model: ObjectModel | null = null;
  private loadToken = 0;
  private notice = 'LOADING CASES…';

  private placed = false;
  private showGhosts = true;
  private lastTime = 0;

  private readonly head = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly rootQuatInverse = new Quaternion();
  private readonly tmp = new Vector3();
  private readonly inputs: Record<'left' | 'right', HandInput>;

  constructor(private readonly renderer: WebGLRenderer) {
    this.taskRoot.matrixAutoUpdate = false;
    this.scene.add(this.taskRoot, this.handVisual.mesh, new AmbientLight(0xffffff, 1.2));
    const sun = new DirectionalLight(0xffffff, 1.5);
    sun.position.set(0.5, 2, 1);
    this.scene.add(sun);

    this.panel = new Panel((id) => this.command(id as Command));
    this.scene.add(this.panel);
    this.inputs = { left: this.blankInput('left'), right: this.blankInput('right') };
  }

  /** Starts on training when it has cases, otherwise on the first sample set. */
  async init() {
    try {
      this.sources = await fetchSources();
      const first = this.sources.findIndex((s) => s.cases > 0);
      await this.openSource(Math.max(0, first));
    } catch (error) {
      this.notice = `API ERROR: ${(error as Error).message}`;
    }
  }

  get source(): SourceInfo | undefined {
    return this.sources[this.sourceIndex];
  }

  /** Re-lists sources first, so folders added to sample-events/ appear without a reload. */
  private async nextSource() {
    const current = this.source?.id;
    this.sources = await fetchSources();
    const i = this.sources.findIndex((s) => s.id === current);
    await this.openSource((i + 1) % this.sources.length);
  }

  private async openSource(i: number) {
    const token = ++this.loadToken;
    this.sourceIndex = i;
    const source = this.sources[i];
    this.panel.setButton('source', `SOURCE: ${source.label}`, false);
    this.notice = `LOADING ${source.label}…`;
    const cases = await fetchCases(source.id);
    if (token !== this.loadToken) return;
    this.cases = cases;
    this.index = 0;
    if (cases.length === 0) {
      this.clearCase();
      this.notice = `${source.label}: NO CASES`;
      return;
    }
    await this.load(0);
  }

  private clearCase() {
    if (this.taskScene) this.taskRoot.remove(this.taskScene);
    this.model?.geometry.dispose();
    this.taskScene = null;
    this.model = null;
    this.session = null;
  }

  /** XR sessions start wherever the user happens to stand, so re-place on entry. */
  onSessionStart() {
    this.placed = false;
  }

  command(id: Command) {
    const n = this.cases.length;
    if (id === 'source' && this.sources.length) {
      this.nextSource().catch((error: Error) => (this.notice = `API ERROR: ${error.message}`));
    } else if (id === 'prev' && n) void this.load((this.index - 1 + n) % n);
    else if (id === 'next' && n) void this.load((this.index + 1) % n);
    else if (id === 'reset') this.session?.reset();
    else if (id === 'ghosts') this.showGhosts = !this.showGhosts;
    else if (id === 'recenter') this.placed = false;
    else if (id === 'impossible' && n) this.toggleImpossible(this.cases[this.index]);
  }

  /** Toggles, so a mis-poke can be undone with a second press. */
  private toggleImpossible(summary: CaseSummary) {
    const verdict = summary.verdict === 'impossible' ? 'feasible' : 'impossible';
    saveVerdict(summary.source, summary.run, summary.case_id, verdict)
      .then((r) => (summary.verdict = r.verdict))
      .catch((error: Error) => (this.notice = `SAVE FAILED: ${error.message}`));
  }

  async load(index: number) {
    const token = ++this.loadToken;
    const summary = this.cases[index];
    this.index = index;
    this.notice = `LOADING ${summary.case_id}…`;
    try {
      const c = await fetchCase(summary.source, summary.run, summary.case_id);
      const obj = await fetchMesh(summary.source, c);
      if (token !== this.loadToken) return; // a newer PREV/NEXT won
      const model = obj
        ? ObjectModel.fromObj(obj, c.object.mesh_scale, CONFIG.surfaceSamples)
        : ObjectModel.fromPointCloud(c.object.point_cloud_local, CONFIG.surfaceSamples);

      this.clearCase();
      this.model = model;
      this.session = new DemoSession(c, model);
      this.taskScene = new TaskScene(c, model);
      this.taskRoot.add(this.taskScene);
      this.notice = '';
    } catch (error) {
      if (token === this.loadToken) this.notice = `LOAD FAILED: ${(error as Error).message}`;
    }
  }

  update(time: number, frame?: XRFrame) {
    const dt = Math.min(0.05, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;

    if (frame) {
      const refSpace = this.renderer.xr.getReferenceSpace();
      if (refSpace) this.hands.update(frame, refSpace, time);
      this.renderer.xr.getCamera().matrixWorld.decompose(this.head, this.headQuat, this.tmp);
    } else {
      this.head.copy(DESKTOP_HEAD);
      this.headQuat.identity();
    }
    if (!this.placed) this.place();

    const session = this.session;
    if (session && this.taskScene) {
      const inputs = this.handInputs();
      const demo = session.update(dt, inputs, this.handRecords());
      if (demo) this.save(session, demo, this.cases[this.index]);

      this.taskScene.object.position.copy(session.grasp.position);
      this.taskScene.object.quaternion.copy(session.grasp.quaternion);
      this.taskScene.ghosts.visible = this.showGhosts;
      const s = session.state;
      this.taskScene.setLook(
        s === 'success' || s === 'saving' || s === 'saved'
          ? 'success'
          : session.grasp.holder
            ? 'held'
            : session.grasp.touching
              ? 'touched'
              : 'idle',
      );
    }

    this.handVisual.update(this.hands, session?.grasp.holder ?? null);
    const tips = [this.hands.left, this.hands.right]
      .filter((h) => h.tracked && h.handedness !== session?.grasp.holder)
      .map((h) => h.joint('index-finger-tip').position);
    this.panel.update(dt, tips);
    this.panel.setButton('ghosts', this.showGhosts ? 'ROBOT ✓' : 'ROBOT', this.showGhosts);
    const impossible = this.cases[this.index]?.verdict === 'impossible';
    this.panel.setButton('impossible', impossible ? 'IMPOSSIBLE ✓' : 'IMPOSSIBLE', impossible);
    this.pushStatus();

    this.renderer.render(this.scene, this.camera);
  }

  /** The robot's origin goes where the user stands, table surface at waist height. */
  private place() {
    const origin = this.head.clone();
    origin.y -= CONFIG.tableDropFromHead;
    taskPlacement(origin, headingYaw(this.headQuat), this.taskRoot.matrix);
    this.taskRoot.updateMatrixWorld(true);
    this.taskRoot.getWorldQuaternion(this.rootQuatInverse).invert();

    this.taskRoot.localToWorld(this.panel.position.copy(PANEL_SIM));
    this.panel.lookAt(this.head);
    this.panel.updateMatrixWorld(true);

    if (!this.renderer.xr.isPresenting) {
      // Desktop: look over the user's right shoulder at the object.
      const object = this.taskRoot.localToWorld(new Vector3(0.5, 0, 0.03));
      this.taskRoot.localToWorld(this.camera.position.set(-0.05, -0.35, 0.35));
      this.camera.lookAt(object);
    }
    this.placed = true;
  }

  private blankInput(handedness: 'left' | 'right'): HandInput {
    const tips = {} as Record<Finger, Vector3>;
    const tipRadius = {} as Record<Finger, number>;
    for (const f of FINGERS) {
      tips[f] = new Vector3();
      tipRadius[f] = 0.008;
    }
    return {
      handedness,
      tracked: false,
      tips,
      tipRadius,
      wristPosition: new Vector3(),
      wristQuaternion: new Quaternion(),
      pinchDistance: Infinity,
    };
  }

  /** Tracked hands re-expressed in the sim frame, which is all the grasp logic sees. */
  private handInputs(): HandInput[] {
    return [this.hands.left, this.hands.right].map((hand) => {
      const input = this.inputs[hand.handedness];
      input.tracked = hand.tracked;
      if (!hand.tracked) return input;
      for (const f of FINGERS) {
        const joint = hand.joint(FINGER_TIPS[f]);
        this.taskRoot.worldToLocal(input.tips[f].copy(joint.position));
        input.tipRadius[f] = joint.radius;
      }
      this.taskRoot.worldToLocal(input.wristPosition.copy(hand.joint('wrist').position));
      input.wristQuaternion.copy(this.rootQuatInverse).multiply(hand.wristQuaternion);
      input.pinchDistance = hand.pinchDistance;
      return input;
    });
  }

  private handRecords(): HandRecord[] {
    const records: HandRecord[] = [];
    for (const hand of [this.hands.left, this.hands.right] as HandState[]) {
      if (!hand.tracked) continue;
      const joints = new Float32Array(HAND_JOINTS.length * 3);
      HAND_JOINTS.forEach((name, i) => {
        this.taskRoot.worldToLocal(this.tmp.copy(hand.joint(name).position)).toArray(joints, i * 3);
      });
      records.push({ handedness: hand.handedness, joints, wristQuaternion: this.inputs[hand.handedness].wristQuaternion });
    }
    return records;
  }

  private save(session: DemoSession, demo: Demo, summary: CaseSummary) {
    saveDemo(summary.source, demo)
      .then((r) => {
        summary.demos = r.demos;
        session.markSaved(true, `SAVED ✓  ${r.demos} DEMO${r.demos === 1 ? '' : 'S'}`);
      })
      .catch((error: Error) => session.markSaved(false, `SAVE FAILED: ${error.message}`));
  }

  private pushStatus() {
    let lines: [string, string, string];
    const summary = this.cases[this.index];
    if (this.notice || !this.session || !summary) {
      lines = [this.notice || 'NO CASE', this.source ? `${this.source.label} · ${this.cases.length} CASES` : '', ''];
    } else {
      const c = this.session.failureCase;
      const hull = this.model?.source === 'point-cloud' ? ' · HULL' : '';
      lines = [
        `${c.object.shape} · YAW ${c.failure_key.yaw_bin} · ${this.index + 1}/${this.cases.length}`,
        `IT ${c.iteration} · ROBOT FAILED ${c.failed_attempts.length}× · ${summary.demos} DEMOS${hull}`,
        summary.verdict === 'impossible' ? 'MARKED IMPOSSIBLE — PRESS AGAIN TO UNDO' : this.session.message,
      ];
    }
    this.panel.setStatus(lines);
    this.onStatus(lines);
  }
}
