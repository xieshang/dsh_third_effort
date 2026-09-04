/**
 * dsh-third-effort — Host plugin.
 *
 * Problem: hand-declared pi-ai routes (third-party gateways listed in the
 * `llm-pi-ai` settings section with plain `- id: <model>` entries) carry no
 * `reasoningEfforts`, so the adapter reports `reasoning: undefined` for those
 * models. The composer then hides the 推理等级 (Effort) row, and no effort can
 * reach the request.
 *
 * What this plugin does: after `llm-pi-ai` has registered its `llm-pi-ai`
 * settings namespace, it scans the configured providers, finds models whose
 * resolved info has no reasoning capability, and writes a `reasoningEfforts`
 * declaration for them back into the SAME namespace via `settings.update`
 * (merge = deep merge over the stored user layer; every other field is left
 * untouched). The write passes through the adapter's own `assertServiceable`
 * validator, so an unserviceable declaration is refused loudly instead of
 * being stored. After the commit, `llm/adapters-updated` fires
 * (`resolveCallWithInfo` path in dsh-llm re-resolves), the model directory
 * refetches, the Effort row appears, and the selected effort flows into
 * requests through the stock `selectModel -> resolveCallConfig -> prepareCall`
 * chain. This plugin adds no request path of its own.
 *
 * Auto-verify: it also listens for `turn/end` and, when a top-level turn
 * stopped `completed` (EOF) or `error` (报错), queues a follow-up asking the
 * agent to confirm completion or keep pushing — unless the closing assistant
 * message already declared done or is awaiting a user decision.
 *
 * Safety:
 * - Only models that currently resolve with NO reasoning info are touched;
 *   models already declaring `reasoningEfforts` (or `false`) are never
 *   overwritten unless `overwrite: true`.
 * - Only providers named in `config.providers` (`'*'` = every provider route
 *   the namespace declares that is not a pi-ai installed-catalog route) are
 *   considered.
 * - Every write is a merge patch scoped to the provider's `models` list entry;
 *   credentials and unrelated fields are never read or written (only the
 *   `llm-pi-ai` namespace's `providers` subtree is patched).
 * - A run writes at most once per provider per boot unless `rescanMs` elapses
 *   and a NEW uncovered model appears; the plugin never removes declarations.
 */

export const name = 'third-effort';

/**
 * Services required before the plugin can mount. `settings` and `llm` exist
 * in every profile; `agents` lets the auto-verify nudge reach the live agent
 * that owns a closing turn. The plugin additionally waits for the `llm-pi-ai`
 * settings namespace to be registered (see apply) instead of assuming it.
 */
export const inject = ['settings', 'llm', 'agents'];

/** Settings namespace owned by the pi-ai adapter plugin. */
const PI_AI_NS = 'llm-pi-ai';

/** Default selectable levels when `config.efforts` is omitted. */
const DEFAULT_EFFORTS = { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' };

/** Default auto-verify follow-up prompt (sent as a plugin user message). */
const DEFAULT_VERIFY_PROMPT = [
  '请检查你刚才的任务是否已经全部完成：',
  '1. 如果已经全部完成，请直接回复“任务已完成”，并简要说明完成结果，不要再做额外工作。',
  '2. 如果还有未完成的部分，请继续推进，把所有未完成的工作做完后再回复“任务已完成”。',
].join('\n');

/**
 * Normalize the plugin configuration with safe defaults.
 * @param config - raw row config from cordis.patch.yml.
 * @returns normalized config.
 */
function normalizeConfig(config) {
  const raw = config ?? {};
  const providers = Array.isArray(raw.providers) && raw.providers.length > 0 ? raw.providers : ['*'];
  const efforts = raw.efforts !== undefined && raw.efforts !== null ? raw.efforts : DEFAULT_EFFORTS;
  const verifyMaxRounds = typeof raw.verifyMaxRounds === 'number' && Number.isFinite(raw.verifyMaxRounds)
    ? Math.max(1, Math.floor(raw.verifyMaxRounds))
    : 3;
  return {
    providers,
    efforts: { ...efforts },
    overwrite: raw.overwrite === true,
    rescanMs: typeof raw.rescanMs === 'number' && Number.isFinite(raw.rescanMs) && raw.rescanMs > 0
      ? Math.floor(raw.rescanMs)
      : 0,
    autoVerify: raw.autoVerify !== false,
    verifyPrompt: typeof raw.verifyPrompt === 'string' && raw.verifyPrompt.trim().length > 0
      ? raw.verifyPrompt.trim()
      : DEFAULT_VERIFY_PROMPT,
    verifyMaxRounds,
  };
}

/**
 * Read the stored `llm-pi-ai` user section (raw, not resolved).
 * @param settings - the settings service.
 * @returns the stored section, or undefined when absent.
 */
function storedSection(settings) {
  try {
    const descriptors = settings.describe({ redactSecrets: true });
    const found = descriptors.find((d) => String(d.ns) === PI_AI_NS);
    if (!found || found.user === undefined || found.user === null) return undefined;
    if (typeof found.user !== 'object' || Array.isArray(found.user)) return undefined;
    return found.user;
  } catch {
    return undefined;
  }
}

/**
 * Decide whether a provider route is covered by this plugin's config.
 * @param route - provider route key from settings.
 * @param cfg - normalized plugin config.
 * @returns whether the route should be processed.
 */
function coversProvider(route, cfg) {
  return cfg.providers.includes('*') || cfg.providers.includes(route);
}

/**
 * Check one model entry for an existing reasoning declaration.
 * @param entry - one `models` list entry (raw stored shape).
 * @returns true when the entry already declares reasoningEfforts (any value
 *   including `false`), false when the field is absent.
 */
function hasReasoningDeclaration(entry) {
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    && Object.prototype.hasOwnProperty.call(entry, 'reasoningEfforts');
}

/**
 * Whether one model's stored declaration already covers the wanted levels.
 * @param entry - one `models` list entry (raw stored shape).
 * @param wanted - normalized wanted efforts dict.
 * @returns true when the entry declares reasoningEfforts with every wanted key.
 */
function declarationCovers(entry, wanted) {
  if (!hasReasoningDeclaration(entry)) return false;
  const declared = entry.reasoningEfforts;
  if (declared === false || declared === null || typeof declared !== 'object' || Array.isArray(declared)) {
    return true; // explicit non-reasoning choice: never touch.
  }
  return Object.keys(wanted).every((level) => Object.prototype.hasOwnProperty.call(declared, level));
}

/**
 * Scan the namespace and ensure every covered model carries a reasoning
 * declaration. Models are checked against live adapter capability
 * (`llm.resolveModelInfo`): a model is patched when it currently resolves
 * with NO reasoning info, or when its stored declaration misses a wanted
 * level (e.g. a newly added `xhigh`). An explicit `false` declaration is
 * always left alone.
 * @param ctx - plugin context.
 * @param cfg - normalized plugin config.
 * @returns number of provider routes patched.
 */
async function ensureEfforts(ctx, cfg) {
  const settings = ctx.settings;
  const llm = ctx.llm;
  const section = storedSection(settings);
  const providers = section !== undefined && section.providers !== undefined && section.providers !== null
    ? section.providers
    : {};
  if (typeof providers !== 'object' || Array.isArray(providers)) {
    ctx.logger.warn('third-effort: llm-pi-ai providers section is not an object; skipping');
    return 0;
  }
  let patched = 0;
  for (const [route, profile] of Object.entries(providers)) {
    if (!coversProvider(route, cfg)) continue;
    if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) continue;
    const models = Array.isArray(profile.models) ? profile.models : [];
    if (models.length === 0) continue;
    // Probe live capability per model; skip routes the adapter does not own.
    let modelsToPatch = [];
    for (const entry of models) {
      const id = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry.id : undefined;
      if (typeof id !== 'string' || id.length === 0) continue;
      const storedHas = hasReasoningDeclaration(entry);
      if (!cfg.overwrite && storedHas && declarationCovers(entry, cfg.efforts)) continue;
      let info;
      try {
        info = await llm.resolveModelInfo(route, id);
      } catch (error) {
        ctx.logger.warn(`third-effort: skipping ${route}/${id}: resolveModelInfo failed (${error?.message ?? error})`);
        continue;
      }
      const liveHas = info !== null && typeof info === 'object' && info.reasoning !== undefined;
      if (liveHas && !cfg.overwrite) {
        // Check the STORED declaration: a missing level (e.g. new xhigh)
        // still needs a patch even though the model already reasons.
        const liveLevels = new Set((info.reasoning.efforts ?? []).map((e) => e.id));
        const missing = Object.keys(cfg.efforts).filter((level) => !liveLevels.has(level));
        if (missing.length === 0) continue;
        if (storedHas && declarationCovers(entry, cfg.efforts)) continue;
      } else if (!cfg.overwrite && storedHas && declarationCovers(entry, cfg.efforts)) {
        continue;
      }
      modelsToPatch.push({ id, entry });
    }
    if (modelsToPatch.length === 0) continue;
    // Build the merged models list: keep every existing field and every
    // already-declared level, add only the missing wanted levels.
    const nextModels = models.map((entry) => {
      const id = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry.id : undefined;
      const hit = modelsToPatch.find((m) => m.id === id);
      if (hit === undefined) return entry;
      const declared = hasReasoningDeclaration(entry)
        && entry.reasoningEfforts !== false
        && entry.reasoningEfforts !== null
        && typeof entry.reasoningEfforts === 'object'
        && !Array.isArray(entry.reasoningEfforts)
        ? entry.reasoningEfforts
        : {};
      return { ...entry, reasoningEfforts: { ...cfg.efforts, ...declared } };
    });
    try {
      await settings.update(PI_AI_NS, { providers: { [route]: { models: nextModels } } });
    } catch (error) {
      ctx.logger.error(`third-effort: refusing to store unserviceable efforts for route "${route}" (${error?.message ?? error})`);
      continue;
    }
    patched += 1;
    ctx.logger.warn(`third-effort: declared reasoningEfforts for ${modelsToPatch.length} model(s) on route "${route}" (${modelsToPatch.map((m) => m.id).join(', ')})`);
  }
  return patched;
}

// --- Auto-verify (nudge after a stopped turn) ---
//
// After a turn closes with `completed` (EOF 完整停止) or `error` (报错停止),
// queue a follow-up telling the model to confirm completion or keep pushing.
// The nudge is skipped when the closing assistant message already declares
// completion (用户: 已回复完成就不再发), or when it awaits a user decision
// (用户: 等决策不发送). `verifyMaxRounds` caps consecutive auto rounds so a
// genuinely broken loop cannot nag forever.

/** Source tag for messages this plugin injects (keeps round counting honest). */
const AUTO_SOURCE = { kind: 'plugin', plugin: 'third-effort' };

/** Phrases that count as an explicit completion declaration. */
const DONE_KEYWORDS = [
  '已完成', '全部完成', '任务已完成', '任务完成', '完成了', '已经完成',
  '都完成了', '完成啦', '完成了任务', 'done', 'DONE', 'finished', 'FINISHED',
  'completed', 'COMPLETED',
];

/** Phrases that must NOT be present for a completion declaration. */
const NOT_DONE_MARKERS = [
  '未完成', '尚未完成', '无法完成', '未能完成', '没完成', '没有完成',
  '还没有完成', '还有未完成', '仍有未完成', 'cannot complete', 'not finished',
  'not completed', 'unfinished',
];

/** Phrases that suggest the model stopped to ask the user a decision. */
const WAITING_MARKERS = [
  '请选择', '请确认', '请决定', '请你决定', '你来决定', '需要你决定', '需要你选择',
  '是否需要', '是否继续', '是否要', '请问', '麻烦你选择', '你来选择', '需要确认',
];

/**
 * Join text blocks of an assistant/message content into one string.
 * @param content - raw assistant message content array.
 * @returns joint text, or '' when empty/absent.
 */
function textOf(message) {
  const content = message !== null && typeof message === 'object' ? message.content : undefined;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Newest assistant message text in the session log.
 * @param session - live session.
 * @returns the last assistant text, or '' when none exists.
 */
function lastAssistantText(session) {
  const events = session.events ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev?.type === 'assistant/message') return textOf(ev.data);
  }
  return '';
}

/**
 * Whether the assistant text declares the work finished.
 * @param text - last assistant text.
 * @returns true when a completion declaration is present and no "not done" marker.
 */
function looksDone(text) {
  const t = String(text ?? '');
  for (const marker of NOT_DONE_MARKERS) if (t.includes(marker)) return false;
  return DONE_KEYWORDS.some((keyword) => t.includes(keyword));
}

/**
 * Whether the assistant text looks like it is waiting on a user decision.
 * @param text - last assistant text.
 * @returns true for question-like or decision-waiting phrasing.
 */
function looksLikeWaiting(text) {
  const t = String(text ?? '').trim();
  if (t.endsWith('?') || t.endsWith('？') || t.endsWith('吗') || t.endsWith('呢')) return true;
  return WAITING_MARKERS.some((marker) => t.includes(marker));
}

/**
 * Consecutive assistant replies since the last non-plugin user message:
 * the number of auto-pursue rounds in the current human-fed stretch.
 * @param session - live session.
 * @returns round count.
 */
function autoRounds(session) {
  const events = session.events ?? [];
  let rounds = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev?.type === 'assistant/message') { rounds += 1; continue; }
    if (ev?.type === 'user/message') {
      const source = ev.data?.source;
      if (source !== null && typeof source === 'object' && source.kind === 'plugin') continue;
      return rounds;
    }
  }
  return rounds;
}

/**
 * Decide whether a stopped turn warrants an auto-verify follow-up.
 * @param session - live session.
 * @param reason - turn/end reason.
 * @param cfg - normalized plugin config.
 * @returns the follow-up message to inject, or undefined to stay quiet.
 */
function verifyFollowup(session, reason, cfg) {
  const kind = reason?.kind;
  // 报错停止 (error) 与 EOF 完整停止 (completed) 才追问; 用户手动中断/blocked
  // /max-tokens 等不打扰。
  if (kind !== 'completed' && kind !== 'error') return undefined;
  const text = lastAssistantText(session);
  // EOF 结束时没有 assistant 输出（如空输入 turn）→ 无事可追问。
  if (kind === 'completed' && text.length === 0) return undefined;
  // 已回复完成任务 → 不再追问。
  if (text.length > 0 && looksDone(text)) return undefined;
  // 等用户决策 → 不发送。
  if (text.length > 0 && looksLikeWaiting(text)) return undefined;
  // 连续自动追问已达上限。
  if (autoRounds(session) >= cfg.verifyMaxRounds) return undefined;
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: cfg.verifyPrompt }],
    source: AUTO_SOURCE,
  };
}

/**
 * Host plugin body. Waits for the `llm-pi-ai` namespace to exist (the adapter
 * registers it during its own mount), runs one ensure pass, then optionally
 * reschedules and re-runs when `settings/document-updated` fires for that
 * namespace.
 * @param ctx - plugin context.
 * @param config - row config from cordis.patch.yml.
 */
export function apply(ctx, config) {
  if (config?.enabled === false) return;
  const cfg = normalizeConfig(config);
  let stopped = false;
  let timer = undefined;
  let running = false;

  const runOnce = async (reason) => {
    if (stopped || running) return;
    running = true;
    try {
      const patched = await ensureEfforts(ctx, cfg);
      if (patched > 0) ctx.logger.warn(`third-effort: patched ${patched} route(s) (${reason})`);
    } catch (error) {
      ctx.logger.error(`third-effort: ensure pass failed (${reason}): ${error?.message ?? error}`);
    } finally {
      running = false;
    }
  };

  const schedule = () => {
    if (stopped || cfg.rescanMs <= 0) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void runOnce('rescan');
      schedule();
    }, cfg.rescanMs);
    // Do not hold the process open for the rescan timer alone.
    if (typeof timer.unref === 'function') timer.unref();
  };

  ctx.effect(() => {
    // Poll briefly for the namespace: this plugin may mount before llm-pi-ai.
    let attempts = 0;
    const iv = setInterval(() => {
      attempts += 1;
      const descriptors = (() => {
        try {
          return ctx.settings.describe({ redactSecrets: true });
        } catch {
          return [];
        }
      })();
      if (descriptors.some((d) => String(d.ns) === PI_AI_NS)) {
        clearInterval(iv);
        void runOnce('boot');
        schedule();
      } else if (attempts >= 100) {
        clearInterval(iv);
        ctx.logger.error('third-effort: llm-pi-ai settings namespace never appeared; giving up');
      }
    }, 500);
    if (typeof iv.unref === 'function') iv.unref();
    // Re-run when the namespace document changes (new routes/models added).
    const off = ctx.on('settings/document-updated', (ns) => {
      if (String(ns) === PI_AI_NS) void runOnce('document-updated');
    });
    return () => {
      stopped = true;
      clearInterval(iv);
      if (timer !== undefined) clearTimeout(timer);
      if (typeof off === 'function') off();
    };
  }, 'third-effort: ensure reasoningEfforts');

  // Auto-verify nudge: listens for every closed turn and, when warranted,
  // injects a follow-up asking the owning agent to finish or confirm done.
  ctx.effect(() => {
    const offTurnEnd = ctx.on('session/event', (session, event) => {
      if (!cfg.autoVerify) return;
      if (event?.type !== 'turn/end') return;
      let agent;
      try {
        agent = ctx.agents?.get(session.id);
      } catch {
        return;
      }
      if (agent === undefined || agent.session !== session) return;
      // Only top-level conversations; delegated children answer their parent.
      if (session.header?.parentSession !== undefined) return;
      const followup = verifyFollowup(session, event.data?.reason, cfg);
      if (followup === undefined) return;
      agent.followup(followup);
      ctx.logger.warn(`third-effort: auto-verify follow-up queued (turn ${event.data?.turn ?? '?'}, reason ${event.data?.reason?.kind ?? '?'})`);
    });
    return () => {
      if (typeof offTurnEnd === 'function') offTurnEnd();
    };
  }, 'third-effort: auto-verify nudge');
}
