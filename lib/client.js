window.__ModuleLoader__.load({
  id: 'dsh-third-effort',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    let react = require('react');
    let react_jsx_runtime = require('react/jsx-runtime');

    /** Services required before mounting. */
    const inject = ['slots', 'locale'];

    /** localStorage key for the per-browser show-time preference. */
    const STORAGE_KEY = 'dsh-third-effort:show-time';
    /** CSS override element id (one per document). */
    const STYLE_ID = 'dsh-third-effort-show-time';
    /** CSS forcing the official hover-only clock labels to stay visible. */
    const SHOW_CSS = '[data-time-hover-root] :is([class*="timeStart"],[class*="timeEnd"]){opacity:1 !important;}';

    /** Read the persisted preference; default ON. */
    function readPref() {
      try {
        return localStorage.getItem(STORAGE_KEY) !== 'off';
      } catch { return true; }
    }

    /** Apply or remove the override stylesheet to match the preference. */
    function applyPref(show) {
      let el = document.getElementById(STYLE_ID);
      if (show) {
        if (el !== null) return;
        el = document.createElement('style');
        el.id = STYLE_ID;
        el.textContent = SHOW_CSS;
        document.head.appendChild(el);
        return;
      }
      if (el !== null) el.remove();
    }

    /** Minimal shared store: one boolean + subscribers. */
    function createShowTimeStore() {
      let value = readPref();
      const listeners = new Set();
      applyPref(value);
      return {
        get: () => value,
        subscribe: (fn) => {
          listeners.add(fn);
          return () => { listeners.delete(fn); };
        },
        set: (next) => {
          if (next === value) return;
          value = next;
          try {
            if (next) localStorage.removeItem(STORAGE_KEY);
            else localStorage.setItem(STORAGE_KEY, 'off');
          } catch {}
          applyPref(value);
          for (const fn of [...listeners]) {
            try { fn(); } catch {}
          }
        },
      };
    }

    const zh = {
      'toggle.showTime': '显示时间',
      'toggle.showTimeOn': '显示消息时间：开',
      'toggle.showTimeOff': '显示消息时间：关',
    };
    const en = {
      'toggle.showTime': 'Show time',
      'toggle.showTimeOn': 'Message time: on',
      'toggle.showTimeOff': 'Message time: off',
    };
    const LOCALE_NS = 'thirdEffort';

    /**
     * Toggle control in the composer tool row, right of the permission
     * select (the `conversation.input.left` list seat renders after the
     * access-mode control and the plan seat). A sliding switch
     * (button[role=switch]) rather than a checkbox, matching the tool-row
     * control posture. The seat owner share (InputZone) carries no lock
     * flag, so the switch stays interactive whenever it is mounted.
     * @param props - owner/session shares from the slot framework.
     */
    function ShowTimeToggle(props) {
      const t = props.t;
      const store = props.store;
      const show = react.useSyncExternalStore(
        react.useCallback((cb) => store.subscribe(cb), [store]),
        react.useCallback(() => store.get(), [store]),
      );
      const label = show ? t('toggle.showTimeOn') : t('toggle.showTimeOff');
      return react_jsx_runtime.jsxs('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 13, lineHeight: '20px',
          color: 'var(--dsw-alias-label-secondary)', userSelect: 'none',
        },
        title: label,
        children: [
          react_jsx_runtime.jsx('span', {
            key: 'text',
            style: { whiteSpace: 'nowrap' },
            children: t('toggle.showTime'),
          }),
          react_jsx_runtime.jsx('button', {
            key: 'switch',
            type: 'button',
            role: 'switch',
            'aria-checked': show,
            'aria-label': label,
            onClick: () => { store.set(!show); },
            style: {
              position: 'relative', width: 32, height: 18, flex: 'none',
              padding: 0, border: 'none', borderRadius: 18, cursor: 'pointer',
              background: show ? 'var(--dsw-alias-button-primary-fill)' : 'var(--dsw-alias-interactive-bg-hover)',
              transition: 'background 120ms ease',
            },
            children: react_jsx_runtime.jsx('span', {
              'aria-hidden': true,
              style: {
                position: 'absolute', top: 2, left: show ? 16 : 2,
                width: 14, height: 14, borderRadius: '50%',
                background: '#fff',
                boxShadow: '0 1px 2px rgba(0,0,0,.25)',
                transition: 'left 120ms ease',
              },
            }),
          }),
        ],
      });
    }

    /**
     * Client plugin body: registers dictionaries + the tool-row switch.
     * @param ctx - the client cordis context (slots, locale).
     */
    function apply(ctx) {
      ctx.effect(() => {
        const offZh = ctx.locale.register(LOCALE_NS, 'zh', zh);
        const offEn = ctx.locale.register(LOCALE_NS, 'en', en);
        return () => { offZh(); offEn(); };
      }, 'dsh-third-effort: dictionaries');
      const store = createShowTimeStore();
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'third-effort-show-time',
        locale: LOCALE_NS,
        inject: () => ({ store }),
      }, ShowTimeToggle));
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
