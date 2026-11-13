// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Adds a "Kitsune" tab next to Canvas / Docs that embeds the review dashboard.
// The dashboard is served by `kitsune serve` (default http://127.0.0.1:4455).
//
// Storybook 9+ entry (imports from 'storybook/manager-api'). manager-sb8.mjs is the Storybook 8 twin.
import React from 'react';
import { addons, types } from 'storybook/manager-api';

const ADDON_ID = 'kitsune-review';
const DASHBOARD_URL = (typeof window !== 'undefined' && window.KITSUNE_URL) || 'http://127.0.0.1:4455';

addons.register(ADDON_ID, () => {
  addons.add(`${ADDON_ID}/tab`, {
    type: types.TAB,
    title: 'Kitsune',
    render: ({ active }) =>
      active
        ? React.createElement('iframe', {
            title: 'Kitsune',
            src: DASHBOARD_URL,
            style: { width: '100%', height: '100%', border: 0, display: 'block' },
          })
        : null,
  });
});
