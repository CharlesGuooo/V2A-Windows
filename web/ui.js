// Small DOM toolkit: hyperscript, SF-Symbol-equivalent icons, the page stack,
// and the shared overlays (context menu, alert dialog, toast).

import { t } from './i18n.js';

// ------------------------------------------------------------- hyperscript

export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'html') el.innerHTML = value;
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'disabled' || key === 'checked' || key === 'hidden' || key === 'readOnly') {
        el[key] = !!value;
      } else if (key === 'value') {
        el.value = value;
      } else {
        el.setAttribute(key, value);
      }
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ------------------------------------------------------------------ icons
// Stroke icons standing in for the SF Symbols the iOS build uses.

const PATHS = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  share: '<path d="M12 3v13"/><polyline points="7 8 12 3 17 8"/><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/>',
  fillDoc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 14 12 17 15 14"/>',
  clock: '<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 3 3 8 8 8"/><polyline points="12 8 12 12 15 14"/>',
  question: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
};

export function icon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (size) { svg.style.width = `${size}px`; svg.style.height = `${size}px`; }
  svg.innerHTML = PATHS[name] || '';
  return svg;
}

// ------------------------------------------------------------- page stack

const stack = [];
let shell = null;
let rootLayer = null;   // the main screen; not part of the stack but must hide behind pages

export function initShell(element) {
  shell = element;
}

// Lets pushPage hide the main screen too, so a pushed page never has the root
// showing through and nothing behind it stays keyboard-focusable.
export function setRootLayer(element) {
  rootLayer = element;
}

function syncRootVisibility() {
  if (rootLayer) rootLayer.hidden = stack.length > 0;
}

// `kind`: 'push' (slide from the right) or 'sheet' (rise from the bottom).
export function pushPage(buildFn, kind = 'push') {
  const layer = h('div', { class: `layer layer--${kind}` });
  const page = { layer, close: () => popPage(page) };
  buildFn(page);
  if (stack.length) stack[stack.length - 1].layer.hidden = true;
  stack.push(page);
  syncRootVisibility();
  shell.appendChild(layer);
  // Move focus into the new page so Tab and Escape work, but land on the page
  // itself rather than the first button — a focus ring on "Cancel" reads as if
  // it were the default action.
  layer.tabIndex = -1;
  layer.focus({ preventScroll: true });
  return page;
}

export function popPage(page) {
  const idx = page ? stack.indexOf(page) : stack.length - 1;
  if (idx < 0) return;
  for (let i = stack.length - 1; i >= idx; i--) {
    stack[i].layer.remove();
    stack[i].onClose?.();
    stack.pop();
  }
  if (stack.length) stack[stack.length - 1].layer.hidden = false;
  syncRootVisibility();
}

export const pageDepth = () => stack.length;

export function popAllPages() {
  while (stack.length) popPage(stack[stack.length - 1]);
}

// ------------------------------------------------------------------ navbar

export function navbar({ title, onBack, backLabel, action }) {
  return h('div', { class: 'navbar' },
    onBack
      ? h('button', { class: 'navbar__btn', onClick: onBack, title: t('取消') },
          icon('chevronLeft'), backLabel || '')
      : h('div', { class: 'navbar__spacer' }),
    h('div', { class: 'navbar__title' }, title),
    action
      ? h('button', {
          class: `navbar__btn navbar__btn--strong${action.danger ? ' navbar__btn--danger' : ''}`,
          onClick: action.onClick,
        }, action.label)
      : h('div', { class: 'navbar__spacer' }),
  );
}

// --------------------------------------------------------- form primitives

export const section = ({ header, footer }, ...rows) =>
  h('div', { class: 'section' },
    header ? h('div', { class: 'section__header' }, header) : null,
    // A section can be header + footer only (an explanatory block); don't draw
    // an empty bordered box in that case.
    rows.some(Boolean) ? h('div', { class: 'section__rows' }, ...rows) : null,
    footer ? h('div', { class: 'section__footer' }, footer) : null,
  );

export const row = (props, ...children) =>
  h('div', { class: `row${props?.class ? ` ${props.class}` : ''}`, ...props, class: undefined },
    ...children);

export function navRow({ label, value, onClick, leading }) {
  return h('button', { class: 'row row--tappable', onClick },
    leading ? h('span', { class: 'row__chevron' }, icon(leading)) : null,
    h('span', { class: 'row__label row__grow' }, label),
    value ? h('span', { class: 'row__value' }, value) : null,
    h('span', { class: 'row__chevron' }, icon('chevronRight')),
  );
}

export function toggleRow({ label, value, onChange }) {
  const sw = h('div', { class: `switch${value ? ' is-on' : ''}`, role: 'switch', 'aria-checked': String(!!value) });
  const el = h('button', {
    class: 'row row--tappable',
    onClick: () => {
      const next = !sw.classList.contains('is-on');
      sw.classList.toggle('is-on', next);
      sw.setAttribute('aria-checked', String(next));
      onChange(next);
    },
  },
    h('span', { class: 'row__label row__grow' }, label),
    sw,
  );
  return el;
}

export function selectRow({ label, value, options, onChange }) {
  const select = h('select', {
    class: 'select',
    onChange: (e) => onChange(e.target.value),
  }, ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  return h('div', { class: 'row' },
    h('span', { class: 'row__label row__grow' }, label),
    select,
  );
}

export function linkRow(label, url, openExternal) {
  return h('button', {
    class: 'row row--tappable row--link',
    onClick: () => openExternal(url),
  }, h('span', { class: 'row__grow' }, label));
}

// -------------------------------------------------------------- overlays

let openMenu = null;

export function showContextMenu(x, y, items) {
  closeContextMenu();
  if (!items.length) return;

  const menu = h('div', { class: 'context-menu' },
    ...items.map((item) => h('button', {
      class: 'context-menu__item',
      onClick: () => { closeContextMenu(); item.onClick(); },
    }, item.label)),
  );
  document.body.appendChild(menu);

  // Keep it on screen.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;

  openMenu = menu;
  setTimeout(() => {
    window.addEventListener('pointerdown', closeContextMenu, { once: true });
    window.addEventListener('keydown', escCloseMenu);
  }, 0);
}

function escCloseMenu(e) {
  if (e.key === 'Escape') closeContextMenu();
}

export function closeContextMenu() {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
  window.removeEventListener('keydown', escCloseMenu);
}

export function confirmDialog({ title, message, confirmLabel, cancelLabel, danger = false }) {
  return new Promise((resolve) => {
    const finish = (value) => { backdrop.remove(); window.removeEventListener('keydown', onKey); resolve(value); };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(false);
      if (e.key === 'Enter') finish(true);
    };
    const backdrop = h('div', {
      class: 'dialog-backdrop',
      onClick: (e) => { if (e.target === backdrop) finish(false); },
    },
      h('div', { class: 'dialog', role: 'alertdialog' },
        h('div', { class: 'dialog__title' }, title),
        message ? h('div', { class: 'dialog__message' }, message) : null,
        h('div', { class: 'dialog__actions' },
          h('button', { class: 'dialog__btn', onClick: () => finish(false) }, cancelLabel || t('取消')),
          h('button', {
            class: `dialog__btn${danger ? ' dialog__btn--danger' : ''}`,
            onClick: () => finish(true),
          }, confirmLabel || t('完成')),
        ),
      ),
    );
    document.body.appendChild(backdrop);
    window.addEventListener('keydown', onKey);
    backdrop.querySelector('.dialog__btn:last-child')?.focus();
  });
}

// ------------------------------------------------------------------ toast

let toastEl = null;
export function renderToast(text) {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast', role: 'status' });
    document.body.appendChild(toastEl);
  }
  if (text) {
    toastEl.textContent = text;
    toastEl.classList.add('is-visible');
  } else {
    toastEl.classList.remove('is-visible');
  }
}
