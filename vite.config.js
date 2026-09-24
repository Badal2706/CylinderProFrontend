import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { refuseLocalApiBuild } from './buildGuard.js';

export default defineConfig({
  // refuseLocalApiBuild: `vite build` fails rather than produce a bundle that calls localhost.
  plugins: [react(), refuseLocalApiBuild()],
});
