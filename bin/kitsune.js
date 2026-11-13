#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { main } from '../src/cli.js';

main(process.argv).catch((err) => {
  console.error(`\nkitsune: ${err.message}`);
  process.exit(2);
});
