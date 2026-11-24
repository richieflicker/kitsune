// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Prints a run (see run-stages.js) in a terminal: one line per stage with its time, a live bar while
// screenshots are taken, and a plain explanation when something fails. Used by `kitsune check` and the worker.

import { formatMs } from './run-stages.js';

const bar = (done, total, width = 20) => {
  const filled = total ? Math.round((done / total) * width) : 0;
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
};

export function terminalReporter({ out = process.stdout, tty = Boolean(process.stdout.isTTY) } = {}) {
  const started = new Set();
  const ended = new Set();
  let liveLine = false;
  const println = (text) => {
    if (liveLine) out.write('\r\x1b[2K');
    liveLine = false;
    out.write(`${text}\n`);
  };

  return (kind, snap) => {
    if (kind === 'progress') {
      const s = snap.stages.find((x) => x.status === 'running' && x.total);
      if (tty && s) {
        out.write(`\r\x1b[2K  ${s.label} ${bar(s.done ?? 0, s.total)} ${s.done ?? 0}/${s.total}`);
        liveLine = true;
      }
      return;
    }
    if (kind !== 'stage') return;
    for (const s of snap.stages) {
      if (s.status === 'running' && !started.has(s.id)) {
        started.add(s.id);
        println(`→ ${s.label}${s.total ? ` (${s.total})` : ''}...`);
      }
      if (['done', 'failed'].includes(s.status) && !ended.has(s.id)) {
        ended.add(s.id);
        const mark = s.status === 'done' ? '✓' : '✗';
        const extra = s.total ? ` (${s.total})` : s.detail ? ` ${s.detail}` : '';
        println(`${mark} ${s.label}${extra}  ${formatMs(s.ms)}`);
      }
    }
    if (snap.status === 'failed' && snap.failure && !ended.has('failure')) {
      ended.add('failure');
      const f = snap.failure;
      println(`\nWhat went wrong: ${f.title}`);
      println(`How to fix it:   ${f.hint}`);
      if (f.excerpt?.length) println(`\n  ${f.excerpt.join('\n  ')}\n`);
    } else if (snap.status === 'done' && !ended.has('done')) {
      ended.add('done');
      const sm = snap.summary ?? {};
      const bits = [];
      if (sm.stories != null) bits.push(`${sm.stories} stor${sm.stories === 1 ? 'y' : 'ies'}`);
      if (sm.screenshots != null) bits.push(`${sm.screenshots} screenshots`);
      println(`\nDone in ${formatMs(snap.ms)}${bits.length ? `: ${bits.join(', ')}` : ''}`);
      if (sm.failedStories?.length) println(`${sm.failedStories.length} could not render (see below)`);
    }
  };
}
