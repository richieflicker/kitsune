// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { createContext, useContext, useEffect, useState } from 'react';

/** Defaults used when the server does not send any (older servers). Mirrors `ui` in kitsune.config.js. */
export const DEFAULT_UI = {
  filter: 'review',
  view: 'side',
  zoom: 'fit',
  theme: 'auto',
  slider: { start: 50, blinkMs: 700, highlight: false, highlightOpacity: 0.85 },
};

export const UiContext = createContext(DEFAULT_UI);
export const useUi = () => useContext(UiContext);

/** Merge what the server sent over the defaults, so a missing field never breaks the page. */
export const withDefaults = (ui) => ({ ...DEFAULT_UI, ...ui, slider: { ...DEFAULT_UI.slider, ...ui?.slider } });

const KEY = 'kitsune-prefs';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export const readPref = (name) => readAll()[name];

export function writePref(name, value) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [name]: value }));
  } catch {
    // private window or blocked storage: the choice just won't be remembered
  }
}

/** A reviewer's own choice wins over the project's configured default; it is remembered in this browser. */
export function usePref(name, fallback) {
  const [value, setValue] = useState(() => readPref(name) ?? fallback);
  const set = (next) => {
    setValue(next);
    writePref(name, next);
  };
  return [value, set];
}

/** Applies light/dark/auto to the whole page. */
export function useTheme(configured) {
  const [theme, setTheme] = usePref('theme', configured);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return [theme, setTheme];
}
