import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { datasetPlugin, resolveRoots } from './server/dataset';

const roots = resolveRoots(process.cwd());
console.log(`[grasp-dataset] training     ${roots.training}`);
console.log(`[grasp-dataset] sample-events ${roots.sampleEvents}`);

export default defineConfig({
  // WebXR needs a secure context: HTTPS on the LAN, or plain localhost via `adb reverse`.
  plugins: [basicSsl(), datasetPlugin(roots)],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 5173 },
});
