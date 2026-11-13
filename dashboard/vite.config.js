// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// During `npm run dev:dashboard`, proxy API + image requests to `kitsune serve` (port 4455).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:4455', '/images': 'http://127.0.0.1:4455' } },
});
