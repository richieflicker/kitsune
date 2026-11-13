// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Adds a "Kitsune" tab next to Canvas / Docs that embeds the review dashboard.
// The dashboard is served by `kitsune serve` (default http://127.0.0.1:4455).
//
// Storybook 8 imports: '@storybook/manager-api'.
// Storybook 9+ moved this to:  import { addons, types } from 'storybook/manager-api';
import React from 'react';
import { addons, types } from '@storybook/manager-api';

const ADDON_ID = 'kitsune-review';
// The sign-in cookie is SameSite=Strict, so the dashboard must be on the same *site* as Storybook. The browser
// treats `localhost` and `127.0.0.1` as different sites, so when both are local, use the host Storybook is on.
function sameSiteUrl(url) {
  try {
    const u = new URL(url);
    const local = ['localhost', '127.0.0.1'];
    if (typeof window !== 'undefined' && local.includes(u.hostname) && local.includes(window.location.hostname)) u.hostname = window.location.hostname;
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}
const DASHBOARD_URL = sameSiteUrl((typeof window !== 'undefined' && window.KITSUNE_URL) || 'http://127.0.0.1:4455');

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
