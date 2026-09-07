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
      'header.requestHeaders': '请求头',
      'header.select': '请求头：选择模拟的 agent 指纹（写入该网关路由）',
      'header.loading': '…',
      'header.noRoute': '在模型选择中选定一个网关供应商后即可切换指纹',
      'header.preset.none': '无',
      'header.preset.custom': '自定义',
      'header.preset.claude': 'Claude',
      'header.preset.codex': 'Codex',
      'header.preset.opencode': 'OpenCode',
    };
    const en = {
      'toggle.showTime': 'Show time',
      'toggle.showTimeOn': 'Message time: on',
      'toggle.showTimeOff': 'Message time: off',
      'header.requestHeaders': 'Headers',
      'header.select': 'Request headers: pick an agent fingerprint (applies to this gateway route)',
      'header.loading': '…',
      'header.noRoute': 'Pick a gateway provider in the model selector first',
      'header.preset.none': 'None',
      'header.preset.custom': 'Custom',
      'header.preset.claude': 'Claude',
      'header.preset.codex': 'Codex',
      'header.preset.opencode': 'OpenCode',
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

    /** POST a method to the host fenced seam; rejects on any non-ok outcome. */
    function apiCall(method, body) {
      return fetch(`/third-effort/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }).then((res) => res.json().catch(() => ({})).then((json) => {
        if (!res.ok || json.ok !== true) {
          throw new Error(json?.error?.message ?? `api ${method} failed (${res.status})`);
        }
        return json;
      }));
    }

    const CHIP_STYLE = {
      display: 'inline-flex', alignItems: 'center', gap: 5, height: 24,
      padding: '0 8px', fontSize: 12, lineHeight: '24px', borderRadius: 6,
      cursor: 'pointer', border: '1px solid var(--dsw-alias-stroke, rgba(128,128,128,.25))',
      background: 'transparent', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap',
    };
    const MENU_STYLE = {
      position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 40,
      minWidth: 176, padding: 4, borderRadius: 8,
      background: 'var(--dsw-alias-panel-section-bg, var(--dsw-alias-bg-elevated, #1e1f24))',
      border: '1px solid var(--dsw-alias-stroke, rgba(128,128,128,.25))',
      boxShadow: '0 6px 24px rgba(0,0,0,.28)',
    };

    /**
     * Composer "请求头" dropdown, mounted in `conversation.input.right` right
     * next to the model selector. The chip renders ALWAYS — it never hides on
     * a missing model directory. The target route is resolved from, in order:
     *   1. the session's current model provider (shared model directory, reactive),
     *   2. a single covered pi-ai route reported by the host (single-route gateways),
     *   3. a route the user picks from the host-reported route list in the menu.
     * Presets + the current preset come from the host `/third-effort/api` seam.
     */
    function HeaderPresetSelect(props) {
      const { t, sessionId, directoryStore, available } = props;
      const snapshot = react.useSyncExternalStore(
        react.useCallback((cb) => {
          if (directoryStore === undefined || directoryStore === null) return () => {};
          return directoryStore.subscribe(cb);
        }, [directoryStore]),
        react.useCallback(() => {
          if (directoryStore === undefined || directoryStore === null) return null;
          return directoryStore.getSnapshot();
        }, [directoryStore]),
      );
      const directoryRoute = available === true && snapshot !== null && snapshot.current !== undefined
        ? snapshot.current.provider
        : undefined;
      const [meta, setMeta] = react.useState(null); // { presets, routes } list
      const [status, setStatus] = react.useState('idle'); // idle | loading | saving | error
      const [open, setOpen] = react.useState(false);
      const [pick, setPick] = react.useState(undefined); // manual route choice
      const [current, setCurrent] = react.useState('none');
      const rootRef = react.useRef(null);

      const routes = meta !== null && Array.isArray(meta.routes) ? meta.routes : [];
      const presets = meta !== null && Array.isArray(meta.presets) ? meta.presets : [];
      const route = directoryRoute !== undefined && directoryRoute.length > 0
        ? directoryRoute
        : (routes.length === 1 ? routes[0].route : pick);

      react.useEffect(() => {
        let cancelled = false;
        setStatus('loading');
        apiCall('presets.list').then((r) => {
          if (cancelled) return;
          setMeta({
            presets: Array.isArray(r.presets) ? r.presets : [],
            routes: Array.isArray(r.routes) ? r.routes : [],
          });
          setStatus('idle');
        }).catch(() => {
          if (cancelled) return;
          setMeta({ presets: [], routes: [] });
          setStatus('error');
        });
        return () => { cancelled = true; };
      }, []);

      // Load + re-attribute when the target route becomes known or changes.
      react.useEffect(() => {
        if (route === undefined || route.length === 0) return undefined;
        let cancelled = false;
        setStatus('loading');
        apiCall('headers.get', { route }).then((r) => {
          if (cancelled) return;
          setCurrent(typeof r.preset === 'string' ? r.preset : 'none');
          setStatus('idle');
        }).catch(() => {
          if (cancelled) return;
          setCurrent('none');
          setStatus('error');
        });
        return () => { cancelled = true; };
      }, [route]);

      react.useEffect(() => {
        if (!open) return undefined;
        const onDown = (event) => {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', onDown);
        return () => document.removeEventListener('pointerdown', onDown);
      }, [open]);

      const label = (id) => {
        const key = `header.preset.${id}`;
        const known = t(key);
        return known !== undefined && known !== key ? known : id;
      };
      const currentText = status === 'loading' || status === 'saving' ? t('header.loading') : label(current);

      const choose = (target, id) => {
        setOpen(false);
        setCurrent(id);
        setStatus('saving');
        apiCall('headers.set', { route: target, preset: id }).then((r) => {
          setCurrent(typeof r.preset === 'string' ? r.preset : 'none');
          setStatus('idle');
        }).catch(() => {
          setStatus('error');
        });
      };

      let menuContent;
      if (route === undefined || route.length === 0) {
        if (routes.length === 0) {
          menuContent = react_jsx_runtime.jsx('div', {
            key: 'hint',
            style: { padding: '8px 10px', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
            children: t('header.noRoute'),
          });
        } else {
          menuContent = routes.map((entry) => react_jsx_runtime.jsxs('button', {
            key: entry.route,
            type: 'button',
            role: 'menuitemradio',
            onClick: () => { setPick(entry.route); },
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 12,
              color: 'var(--dsw-alias-label)', background: 'transparent', border: 'none',
              cursor: 'pointer', textAlign: 'left',
            },
            children: [
              react_jsx_runtime.jsx('span', { key: 'name', style: { whiteSpace: 'nowrap' }, children: entry.name }),
              react_jsx_runtime.jsx('span', { key: 'p', style: { whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary)', fontSize: 11 }, children: label(entry.preset) }),
            ],
          }));
        }
      } else {
        menuContent = presets.map((entry) => react_jsx_runtime.jsxs('button', {
          key: entry.id,
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': entry.id === current,
          onClick: () => { choose(route, entry.id); },
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 12,
            color: entry.id === current ? 'var(--dsw-alias-accent, #4da3ff)' : 'var(--dsw-alias-label)',
            background: entry.id === current ? 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.06))' : 'transparent',
            border: 'none', cursor: 'pointer', textAlign: 'left',
          },
          children: [
            react_jsx_runtime.jsx('span', { key: 'label', style: { whiteSpace: 'nowrap' }, children: label(entry.id) }),
            react_jsx_runtime.jsx('span', { key: 'check', 'aria-hidden': true, style: { opacity: entry.id === current ? 1 : 0 }, children: '✓' }),
          ],
        }));
      }

      return react_jsx_runtime.jsx('span', {
        ref: rootRef,
        style: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
        children: react_jsx_runtime.jsxs(react.Fragment, {
          children: [
            react_jsx_runtime.jsxs('button', {
              key: 'chip',
              type: 'button',
              title: t('header.select'),
              'aria-haspopup': 'menu',
              'aria-expanded': open,
              onClick: () => { setOpen(!open); },
              style: CHIP_STYLE,
              children: [
                react_jsx_runtime.jsx('span', { key: 'name', style: { color: 'var(--dsw-alias-label)' }, children: t('header.requestHeaders') }),
                react_jsx_runtime.jsx('span', { key: 'value', style: { color: 'var(--dsw-alias-label-secondary)' }, children: currentText }),
                react_jsx_runtime.jsx('span', { key: 'caret', 'aria-hidden': true, style: { fontSize: 9, opacity: .7 }, children: '▾' }),
              ],
            }),
            open ? react_jsx_runtime.jsx('div', {
              key: 'menu',
              role: 'menu',
              style: MENU_STYLE,
              children: menuContent,
            }) : null,
          ],
        }),
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
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'third-effort-header-preset',
        order: 120,
        locale: LOCALE_NS,
        inject: (sessionId) => {
          // Optional sibling service (provided by ui-model-selection): resolve it
          // lazily so an absent model directory never blocks the chip — the
          // dropdown falls back to the host-reported route list instead.
          let directoryStore = undefined;
          let available = false;
          try {
            const models = ctx.get('modelDirectories');
            if (models !== undefined && models !== null) {
              const directory = models.directoryFor(sessionId);
              directoryStore = directory.store;
              available = directoryStore !== undefined && directoryStore !== null;
            }
          } catch {
            // Session resolves no scope yet; the dropdown simply won't show a
            // pre-highlighted route for this session.
          }
          return { sessionId, directoryStore, available };
        },
      }, HeaderPresetSelect));
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
