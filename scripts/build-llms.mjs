// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Regenerates llms-full.txt (all docs in one file for AI tools) from README.md and COMMANDS.md.
// Run: npm run build:llms   (llms.txt is the short hand-written index and is not generated)
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), 'utf8').trim();

const out = `# Kitsune Review: full documentation

> Everything an AI assistant needs to install, configure and run Kitsune Review, generated from README.md and COMMANDS.md.
> Author: Richie Flicker.

---

${read('README.md')}

---

${read('COMMANDS.md')}
`;
fs.writeFileSync(new URL('llms-full.txt', root), out);
console.log(`llms-full.txt written (${out.length} characters)`);
