// Stand-in for a real Storybook build: each story id maps to some HTML.
// Edit a value here, re-run `kitsune check`, and exactly the affected stories get flagged.

export const css = `
  :root { font-family: system-ui, sans-serif; color: #1c2430; }
  body { margin: 0; background: #fff; }
  #storybook-root { padding: 24px; }
  .btn { font: 600 14px system-ui; border: 0; border-radius: 8px; padding: 10px 18px; cursor: pointer; }
  .btn-primary { background: #7c3aed; color: #fff; }
  .btn-secondary { background: #e5e7eb; color: #111827; }
  .btn[disabled] { opacity: .45; cursor: not-allowed; }
  .card { width: 320px; border: 1px solid #e2e5ea; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .card h3 { margin: 0 0 8px; font-size: 16px; }
  .card p { margin: 0; color: #667085; font-size: 14px; line-height: 1.4; }
  .badges { display: flex; gap: 8px; }
  .badge { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
  .b-ok { background: #dcfce7; color: #166534; } .b-warn { background: #fef3c7; color: #92400e; } .b-bad { background: #fee2e2; color: #991b1b; }
  .field { display: grid; gap: 6px; width: 280px; }
  .field input { font: 14px system-ui; padding: 9px 12px; border: 1px solid #dc2626; border-radius: 8px; }
  .field .err { color: #dc2626; font-size: 12px; }
  .nav { display: flex; align-items: center; gap: 20px; padding: 12px 20px; background: #0f172a; color: #fff; border-radius: 10px; }
  .nav a { color: #cbd5e1; font-size: 14px; text-decoration: none; }
  .nav .brand { font-weight: 700; color: #fff; margin-right: auto; }
  .pulse { width: 36px; height: 36px; border-radius: 50%; background: #2563eb; animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.6); opacity: .3; } }
`;

export const stories = {
  'button--primary': () => `<button class="btn btn-primary">Save changes</button>`,
  'button--secondary': () => `<button class="btn btn-secondary">Cancel</button>`,
  'button--disabled': () => `<button class="btn btn-primary" disabled>Save changes</button>`,
  'card--default': () => `<div class="card"><h3>Appointment</h3><p>Dr. Rao, Tuesday 10:30 AM. Bring previous X-rays.</p></div>`,
  'card--long-title': () => `<div class="card"><h3>Root canal treatment follow-up with the endodontics team</h3><p>Check healing and schedule the crown fitting.</p></div>`,
  'badge--list': () => `<div class="badges"><span class="badge b-ok">Paid</span><span class="badge b-warn">Pending</span><span class="badge b-bad">Overdue</span></div>`,
  'form--error': () => `<label class="field">Phone number<input value="98765" /><span class="err">Enter a 10-digit number</span></label>`,
  'navbar--default': () => `<nav class="nav"><span class="brand">Clinic</span><a>Patients</a><a>Calendar</a><a>Billing</a></nav>`,
  'loader--pulse': () => `<div class="pulse"></div>`,
  'internal--scratch': () => `<p>scratch</p>`,
};
