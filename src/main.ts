import { WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { App, type Command } from './app';
import { requestSession, supportedMode } from './xr/session';

const overlay = document.getElementById('overlay') as HTMLDivElement;
const enterButton = document.getElementById('enter-xr') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLParagraphElement;
const caseStatus = document.getElementById('case-status') as HTMLPreElement;

const renderer = new WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.setClearColor(0x0b0f14, 1);
document.body.appendChild(renderer.domElement);

const app = new App(renderer);
app.onStatus = (lines) => {
  const text = lines.filter(Boolean).join('\n');
  if (caseStatus.textContent !== text) caseStatus.textContent = text;
};

// Desktop preview: orbit around the object to inspect a case before putting the headset on.
const controls = new OrbitControls(app.camera, renderer.domElement);
controls.target.set(0, 1.13, -0.5);
controls.update();

window.addEventListener('resize', () => {
  app.camera.aspect = window.innerWidth / window.innerHeight;
  app.camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.dispatchEvent(new Event('resize'));

const KEYS: Record<string, Command> = {
  s: 'source',
  n: 'next',
  p: 'prev',
  r: 'reset',
  g: 'ghosts',
  x: 'impossible',
};
window.addEventListener('keydown', (e) => {
  const command = KEYS[e.key.toLowerCase()];
  if (command) app.command(command);
});

renderer.setAnimationLoop((time, frame) => {
  if (!renderer.xr.isPresenting) controls.update();
  app.update(time, frame);
});

void app.init();

supportedMode().then((mode) => {
  if (!mode) {
    enterButton.textContent = 'WebXR unavailable';
    status.textContent = 'Desktop preview only (drag to orbit; S source, N/P cases, G robot attempts). Open on a Quest 3 to demonstrate.';
    return;
  }
  enterButton.disabled = false;
  enterButton.textContent = mode === 'immersive-ar' ? 'Enter AR' : 'Enter VR';
  status.textContent = 'Hand tracking must be on (Settings → Movement Tracking → Hand and Body Tracking).';

  enterButton.addEventListener('click', async () => {
    enterButton.disabled = true;
    try {
      const session = await requestSession(mode);
      renderer.setClearColor(0x000000, mode === 'immersive-ar' ? 0 : 1);
      await renderer.xr.setSession(session);
      app.onSessionStart();
      overlay.style.display = 'none';
      session.addEventListener('end', () => {
        renderer.setClearColor(0x0b0f14, 1);
        app.onSessionStart();
        overlay.style.display = 'flex';
        enterButton.disabled = false;
      });
    } catch (error) {
      enterButton.disabled = false;
      status.textContent = `Could not start the session: ${(error as Error).message}`;
    }
  });
});
