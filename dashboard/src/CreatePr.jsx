// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { useEffect, useMemo, useState } from 'react';
import { branchSource, getBranches, prLink } from './api.js';

/**
 * "Create PR": choose the target branch and open your host's pull request page with source and target filled in.
 * The link is prepared before you click, so the click is a plain link and never blocked as a popup.
 */
export default function CreatePr({ id, onClose }) {
  const [review, setReview] = useState(null);
  const [listing, setListing] = useState(null);
  const [target, setTarget] = useState('');
  const [link, setLink] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([branchSource(id).loadBuild(), getBranches()])
      .then(([b, l]) => {
        setReview(b);
        setListing(l);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  const head = useMemo(() => listing?.remote.find((b) => b.ref === review?.branch) ?? null, [listing, review]);
  const targets = useMemo(() => (head ? listing.remote.filter((b) => b.remote === head.remote && b.name !== head.name) : []), [listing, head]);

  // Default target: the branch this was compared against.
  useEffect(() => {
    if (!head || target) return;
    const baseName = review.base.startsWith(`${head.remote}/`) ? review.base.slice(head.remote.length + 1) : review.base;
    setTarget(targets.some((t) => t.name === baseName) ? baseName : targets[0]?.name ?? '');
  }, [head, targets, review, target]);

  useEffect(() => {
    if (!target) return undefined;
    let stale = false;
    setLink(null);
    setError(null);
    prLink(id, target)
      .then((res) => !stale && setLink(res))
      .catch((err) => !stale && setError(err.message));
    return () => {
      stale = true;
    };
  }, [id, target]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy was blocked by the browser. Open the page and copy the address from there.');
    }
  }

  const approved = review ? review.summary.accepted + review.summary.new + review.summary.unchanged : 0;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pr-title">
        <h2 id="pr-title">Create pull request</h2>

        {review && (
          <p className="muted">
            Everything is approved: {review.summary.accepted} {review.summary.accepted === 1 ? 'change' : 'changes'} accepted, {approved - review.summary.accepted} unchanged or new.
          </p>
        )}

        {head === null && review && listing && (
          <div className="banner banner-info">This review was built from a local branch. Push it to the remote and build from the remote branch to open a pull request.</div>
        )}

        {head && (
          <div className="pr-flow">
            <div className="br-field">
              <span className="br-label">From <small className="muted">your branch</small></span>
              <code className="pr-branch">{head.name}</code>
            </div>
            <span className="br-arrow" aria-hidden="true">→</span>
            <label className="br-field">
              <span className="br-label">Into <small className="muted">target branch</small></span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {targets.map((t) => <option key={t.ref} value={t.name}>{t.name}</option>)}
              </select>
            </label>
          </div>
        )}

        {error && <div className="banner">{error}</div>}

        {link && (
          <p className="muted pr-where">
            Opens the <strong>{link.provider}</strong> page for {link.source} → {link.target}. You press Create there; Kitsune doesn’t create it for you.
          </p>
        )}

        <div className="modal-actions">
          <button className="btn btn-quiet" onClick={onClose}>Close</button>
          <button className="btn" disabled={!link} onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
          {link ? (
            <a className="btn btn-primary" href={link.url} target="_blank" rel="noopener noreferrer">Open pull request page ↗</a>
          ) : (
            <button className="btn btn-primary" disabled>Open pull request page ↗</button>
          )}
        </div>
      </div>
    </div>
  );
}
