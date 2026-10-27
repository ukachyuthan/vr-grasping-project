import { CanvasTexture, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three';
import { CONFIG } from '../config';

const PANEL_WIDTH = 0.3;
const PADDING = 0.012;
const BUTTON_HEIGHT = 0.045;
const GAP = 0.008;
const STATUS_HEIGHT = 0.07;
const TOUCH_DEPTH = 0.03;

const CSS = { primary: '#4fd1ff', dim: '#5b7f96', panel: 'rgba(6, 12, 18, 0.92)', ink: '#061018', ok: '#5ce08a' };

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  return { canvas, ctx: canvas.getContext('2d')!, texture };
}

class PanelButton {
  readonly mesh: Mesh;
  private readonly surface: ReturnType<typeof makeCanvas>;
  private inside = false;
  private label = '';
  private active = false;

  constructor(
    readonly id: string,
    readonly width: number,
    readonly height: number,
    private readonly onPress: (id: string) => void,
  ) {
    // Match the canvas to the button's aspect, so wide buttons are not stretched.
    this.surface = makeCanvas(Math.round((112 * width) / height), 112);
    this.mesh = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ map: this.surface.texture, transparent: true }),
    );
    this.draw();
  }

  setState(label: string, active: boolean) {
    if (label === this.label && active === this.active) return;
    this.label = label;
    this.active = active;
    this.draw();
  }

  /** Fires once per entry, so a resting fingertip does not repeat. */
  testTouch(localPoints: Vector3[]) {
    const hit = localPoints.some(
      (p) =>
        Math.abs(p.x - this.mesh.position.x) <= this.width / 2 &&
        Math.abs(p.y - this.mesh.position.y) <= this.height / 2 &&
        Math.abs(p.z) <= TOUCH_DEPTH,
    );
    if (hit && !this.inside) this.onPress(this.id);
    this.inside = hit;
  }

  private draw() {
    const { canvas, ctx, texture } = this.surface;
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.active ? CSS.primary : CSS.panel;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = CSS.primary;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = this.active ? CSS.ink : CSS.primary;
    // Shrink long labels (source names) until they fit.
    let size = 44;
    do ctx.font = `600 ${size}px ui-monospace, Menlo, monospace`;
    while (ctx.measureText(this.label).width > w - 24 && (size -= 2) > 20);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.label, w / 2, h / 2 + 2);
    texture.needsUpdate = true;
  }
}

const LAYOUT: { id: string; label: string }[][] = [
  [{ id: 'source', label: 'SOURCE' }],
  [
    { id: 'prev', label: '◀ PREV' },
    { id: 'next', label: 'NEXT ▶' },
  ],
  [
    { id: 'reset', label: 'RETRY' },
    { id: 'ghosts', label: 'ROBOT' },
  ],
  [{ id: 'recenter', label: 'RECENTER' }],
  [{ id: 'impossible', label: 'IMPOSSIBLE' }],
];

/**
 * Poke-button menu, placed beside the table rather than following the head,
 * so it stays put while you reach and lean over the object.
 */
export class Panel extends Group {
  private readonly buttons = new Map<string, PanelButton>();
  private readonly status = makeCanvas(768, 192);
  private statusText = ['', '', ''];
  private cooldown = 0;
  private readonly local = new Vector3();

  constructor(onPress: (id: string) => void) {
    super();
    const contentWidth = PANEL_WIDTH - PADDING * 2;
    const rows = LAYOUT.length;
    const height = PADDING * 2 + STATUS_HEIGHT + GAP + rows * BUTTON_HEIGHT + (rows - 1) * GAP;

    const backing = new Mesh(
      new PlaneGeometry(PANEL_WIDTH, height),
      new MeshBasicMaterial({ color: 0x03080d, transparent: true, opacity: 0.85 }),
    );
    backing.position.z = -0.002;
    this.add(backing);

    const statusMesh = new Mesh(
      new PlaneGeometry(contentWidth, STATUS_HEIGHT),
      new MeshBasicMaterial({ map: this.status.texture, transparent: true }),
    );
    statusMesh.position.y = height / 2 - PADDING - STATUS_HEIGHT / 2;
    this.add(statusMesh);

    let y = statusMesh.position.y - STATUS_HEIGHT / 2 - GAP - BUTTON_HEIGHT / 2;
    for (const row of LAYOUT) {
      const width = (contentWidth - GAP * (row.length - 1)) / row.length;
      let x = -contentWidth / 2;
      for (const slot of row) {
        const button = new PanelButton(slot.id, width, BUTTON_HEIGHT, (id) => {
          if (this.cooldown > 0) return;
          this.cooldown = CONFIG.buttonCooldown;
          onPress(id);
        });
        button.setState(slot.label, false);
        button.mesh.position.set(x + width / 2, y, 0);
        this.buttons.set(slot.id, button);
        this.add(button.mesh);
        x += width + GAP;
      }
      y -= BUTTON_HEIGHT + GAP;
    }
    this.drawStatus();
  }

  setButton(id: string, label: string, active: boolean) {
    this.buttons.get(id)?.setState(label, active);
  }

  setStatus(lines: [string, string, string]) {
    if (lines.every((l, i) => l === this.statusText[i])) return;
    this.statusText = lines;
    this.drawStatus();
  }

  /** `fingertips` in world space; only index tips should be passed, so a grasp never presses. */
  update(dt: number, fingertips: Vector3[]) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const local = fingertips.map((tip) => this.worldToLocal(this.local.copy(tip)).clone());
    for (const button of this.buttons.values()) button.testTouch(local);
  }

  private drawStatus() {
    const { canvas, ctx, texture } = this.status;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const styles: [string, string][] = [
      [CSS.primary, '600 38px ui-monospace, Menlo, monospace'],
      [CSS.dim, '400 32px ui-monospace, Menlo, monospace'],
      [CSS.ok, '600 38px ui-monospace, Menlo, monospace'],
    ];
    this.statusText.forEach((line, i) => {
      ctx.fillStyle = styles[i][0];
      ctx.font = styles[i][1];
      ctx.fillText(line, 10, 32 + i * 62);
    });
    texture.needsUpdate = true;
  }
}
