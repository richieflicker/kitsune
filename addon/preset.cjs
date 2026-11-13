// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Storybook preset for Kitsune Review: registers the "Kitsune" tab in the manager UI.
//
//   // .storybook/main.js
//   addons: [{ name: 'kitsune-review', options: { url: 'https://kitsune.example.com' } }]
//
// `url` is where the dashboard runs: `kitsune serve` (default http://127.0.0.1:4455) or your shared server.
// The KITSUNE_URL environment variable at Storybook start/build time works too.
// Storybook 9+ exposes the manager API as `storybook/manager-api`; Storybook 8 as `@storybook/manager-api`.
function hasStorybook9Api() {
  try {
    require.resolve('storybook/manager-api', { paths: [process.cwd(), __dirname] });
    return true;
  } catch {
    return false;
  }
}

function managerEntries(entry = []) {
  return [...entry, require.resolve(hasStorybook9Api() ? './manager-sb9.mjs' : './manager-sb8.mjs')];
}

function managerHead(head, options = {}) {
  const url = options.url || process.env.KITSUNE_URL || 'http://127.0.0.1:4455';
  // JSON.stringify + escaping "<" keeps a hostile URL from closing the script tag.
  const safe = JSON.stringify(String(url)).replace(/</g, '\\u003c');
  return `${head ?? ''}<script>window.KITSUNE_URL = ${safe};</script>`;
}

module.exports = { managerEntries, managerHead };
