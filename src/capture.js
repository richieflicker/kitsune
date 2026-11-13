// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { chromium, firefox, webkit } from 'playwright';
import { paintRegions } from './regions.js';

const ENGINES = { chromium, firefox, webkit };

const FREEZE_CSS = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}`;

async function captureOne(page, cfg, rules, url, outFile) {
  await page.goto(url, { waitUntil: 'load', timeout: rules.timeout });
  // Resolve on either a rendered story or one of Storybook's error screens, so a broken story fails fast
  // with its real message instead of waiting out the full timeout. This uses waitForFunction rather than
  // waitForSelector on purpose: Storybook's error screens are position:fixed, which leaves <body> with no
  // size, and Playwright does not count a zero-size element as "visible".
  await page.waitForFunction(
    (readySelector) => {
      const cls = document.body.classList;
      return cls.contains('sb-show-errordisplay') || cls.contains('sb-show-nopreview') || Boolean(document.querySelector(readySelector));
    },
    cfg.readySelector,
    { timeout: rules.timeout },
  );

  const failure = await page.evaluate(() => {
    const cls = document.body.classList;
    if (cls.contains('sb-show-errordisplay')) {
      const message = document.querySelector('#error-message')?.textContent?.trim();
      const stack = document.querySelector('#error-stack')?.textContent?.trim().split('\n')[0];
      return message || stack || 'Story failed to render';
    }
    if (cls.contains('sb-show-nopreview')) return 'Storybook shows "No Preview": the story was not found or has nothing to render';
    return null;
  });
  if (failure) throw new Error(failure);

  await page.waitForLoadState('networkidle', { timeout: rules.timeout }).catch(() => {});
  const hideCss = rules.hide.map((sel) => `${sel} { visibility: hidden !important; }`).join('\n');
  await page.addStyleTag({ content: [cfg.freezeAnimations ? FREEZE_CSS : '', hideCss, rules.css].join('\n') });

  if (rules.waitFor) {
    await page.waitForSelector(rules.waitFor, { state: 'attached', timeout: rules.timeout }).catch(() => {
      throw new Error(`waitFor "${rules.waitFor}" never appeared on the page`);
    });
  }
  if (cfg.waitForFonts) {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    });
  }
  if (rules.delay) await page.waitForTimeout(rules.delay);

  const opts = {
    path: outFile,
    animations: cfg.freezeAnimations ? 'disabled' : 'allow',
    caret: 'hide',
    mask: rules.mask.map((sel) => page.locator(sel)),
    maskColor: cfg.maskColor,
  };
  if (rules.selector) await page.locator(rules.selector).first().screenshot(opts);
  else await page.screenshot({ ...opts, fullPage: rules.fullPage });
  paintRegions(outFile, rules.ignoreRegions, cfg.maskColor);
}

/** Launch every configured browser up front so a missing one fails before any work is done. */
async function launchAll(cfg) {
  const launched = [];
  try {
    for (const def of cfg.browsers) {
      try {
        const browser = await ENGINES[def.type].launch({
          headless: true,
          executablePath: def.executablePath,
          channel: def.channel,
          args: def.args,
        });
        launched.push({ def, browser });
      } catch (err) {
        const first = String(err.message).split('\n')[0];
        const missing = /executable doesn't exist|playwright install/i.test(err.message);
        throw new Error(
          missing
            ? `Browser "${def.name}" is not installed. Run: npx playwright install ${def.type}`
            : `Could not launch browser "${def.name}": ${first}`,
        );
      }
    }
  } catch (err) {
    await Promise.all(launched.map((l) => l.browser.close().catch(() => {})));
    throw err;
  }
  return launched;
}

/**
 * Screenshot every job: { story, viewport, browser, key, rules }. Jobs are grouped per browser and viewport,
 * because each group needs its own browser context.
 * Returns [{ ...job, ok, error? }] (never throws for a single bad story).
 */
export async function captureAll({ cfg, baseUrl, jobs, fileFor, onProgress }) {
  const launched = await launchAll(cfg);
  const results = [];

  try {
    for (const { def, browser } of launched) {
      for (const viewport of cfg.viewports) {
        const group = jobs.filter((j) => j.browser.name === def.name && j.viewport.name === viewport.name);
        if (!group.length) continue;
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: cfg.deviceScaleFactor,
          reducedMotion: cfg.reducedMotion,
          colorScheme: cfg.colorScheme,
          locale: cfg.locale,
          timezoneId: cfg.timezoneId,
        });

        const queue = [...group];
        const worker = async () => {
          const page = await context.newPage();
          while (queue.length) {
            const job = queue.shift();
            const url = `${baseUrl}/iframe.html?id=${encodeURIComponent(job.story.id)}&viewMode=story`;
            try {
              await captureOne(page, cfg, job.rules, url, fileFor(job.key));
              results.push({ ...job, ok: true });
            } catch (err) {
              results.push({ ...job, ok: false, error: String(err.message).split('\n')[0] });
            }
            onProgress?.(results.length);
          }
        };

        await Promise.all(Array.from({ length: Math.min(cfg.concurrency, group.length) }, worker));
        await context.close();
      }
    }
  } finally {
    await Promise.all(launched.map((l) => l.browser.close().catch(() => {})));
  }
  return results;
}
