import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  EMPTY_SESSION_SUMMARY,
  failureNote,
  generateTaskSummary,
  loadingSummaryFrame,
  recentRequests,
  reportTaskSummary,
  substantiveRequest,
  type HerdrEnvironment,
} from "./summary.ts";

export function registerHerdrTaskSummary(
  pi: ExtensionAPI,
  environment: HerdrEnvironment = process.env as HerdrEnvironment,
  { debounceMs = 500, timeoutMs = 30_000, animationMs = 160 } = {},
) {
  // No model requests, timers, or session inspection outside a Herdr pane.
  if (environment.HERDR_ENV !== "1" || !environment.HERDR_PANE_ID?.trim()) return;

  let started = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let stopAnimation: (() => void) | undefined;
  let lastKey: string | undefined;
  let lastSummary = EMPTY_SESSION_SUMMARY;
  const cache = new Map<string, string>();
  let reports = Promise.resolve();

  function cancel() {
    generation++;
    clearTimeout(timer);
    timer = undefined;
    stopAnimation?.();
    controller?.abort();
    controller = undefined;
  }

  // `failure`: a note sets the pane's task_summary_error token, null clears it,
  // undefined (animation frames) leaves it alone.
  function publish(summary: string, version: number, current = () => started, failure?: string | null) {
    // Serialize IPC so a slow older publication cannot overtake a newer title.
    reports = reports.then(async () => {
      if (!current() || version !== generation) return;
      await reportTaskSummary(summary, environment,
        (command, args) => pi.exec(command, args, { timeout: 2000 }), failure);
    });
    return reports;
  }

  function animate(summary: string, version: number) {
    let frame = 0;
    let stopped = false;
    let frameTimer: ReturnType<typeof setTimeout> | undefined;
    const current = () => started && !stopped && version === generation;
    const stop = () => {
      stopped = true;
      clearTimeout(frameTimer);
      if (stopAnimation === stop) stopAnimation = undefined;
    };
    stopAnimation = stop;
    const draw = async () => {
      if (!current()) return;
      await publish(loadingSummaryFrame(summary, frame++), version, current);
      if (!current()) return;
      // Backpressure: wait for this IPC before scheduling another frame. A slow
      // server never accumulates an animation backlog ahead of the real title.
      frameTimer = setTimeout(() => void draw(), animationMs);
      frameTimer.unref?.();
    };
    void draw();
    return stop;
  }

  function schedule(requests: string[], ctx: ExtensionContext) {
    const model = ctx.model;
    const key = JSON.stringify([model?.provider, model?.id, requests]);
    if (key === lastKey) return;
    cancel();
    lastKey = key;
    const version = generation;
    const cached = cache.get(key);
    if (cached) lastSummary = cached;
    if (cached || !model || !requests.length) {
      void publish(lastSummary, version, undefined,
        !cached && requests.length ? failureNote("no model selected") : null);
      return;
    }
    const stopLoading = animate(lastSummary, version);

    // Snapshot the selection: a later model/session switch must not redirect this request.
    const namingContext = { model, modelRegistry: ctx.modelRegistry };
    const abort = new AbortController();
    controller = abort;
    timer = setTimeout(() => {
      timer = undefined;
      void (async () => {
        let timedOut = false;
        let failure: string | undefined;
        let named = false;
        const deadline = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
        deadline.unref?.();
        let onAbort: () => void = () => {};
        const cancelled = new Promise<undefined>((resolve) => {
          onAbort = () => resolve(undefined);
          abort.signal.addEventListener("abort", onAbort, { once: true });
        });
        try {
          // Bound our wait even if a custom provider ignores cancellation.
          const summary = await Promise.race([
            generateTaskSummary(requests, namingContext, abort.signal, (reason) => { failure = reason; }),
            cancelled,
          ]);
          if (!summary || abort.signal.aborted || version !== generation || !started) return;
          lastSummary = summary;
          named = true;
          cache.set(key, summary);
          if (cache.size > 32) cache.delete(cache.keys().next().value!);
        } catch (error) {
          // Auth, provider, timeout and malformed-output failures never affect the agent.
          // Keep the previous semantic title, not a misleading prompt excerpt.
          failure = `request failed: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
          clearTimeout(deadline);
          abort.signal.removeEventListener("abort", onAbort);
          stopLoading();
          if (controller === abort) controller = undefined;
          // Success settles on the semantic title; every failure restores the
          // last stable title. Neither animation frames nor failures enter cache.
          // Failures are recorded on the pane so a stuck label can be explained.
          if (timedOut) failure = `no reply within ${timeoutMs / 1000}s`;
          if (started && version === generation) {
            void publish(lastSummary, version, undefined,
              named ? null : failureNote(failure ?? "no usable title"));
          }
        }
      })();
    }, debounceMs);
    timer.unref?.();
  }

  function restore(ctx: ExtensionContext) {
    cancel();
    lastKey = undefined;
    lastSummary = EMPTY_SESSION_SUMMARY;
    schedule(recentRequests(ctx.sessionManager.getBranch()), ctx);
  }

  pi.on("session_start", (_event, ctx) => {
    started = true;
    cache.clear();
    restore(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    if (started) restore(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    if (started) schedule(recentRequests(ctx.sessionManager.getBranch()), ctx);
  });

  pi.on("message_end", (event, ctx) => {
    if (!started || event.message.role !== "user" || !substantiveRequest(event.message.content)) return;
    // Pi emits this before persisting the current message, so include it explicitly.
    // Returning nothing leaves stored and model-visible content unchanged.
    schedule(recentRequests(ctx.sessionManager.getBranch(), event.message.content), ctx);
  });

  pi.on("session_shutdown", async () => {
    started = false;
    cancel();
    cache.clear();
    // Drain in-flight frames and restore stable text before tearing down this
    // runtime, even on quit. Never leave scrambled metadata behind on the pane.
    await publish(lastSummary, generation, () => true);
  });
}

export default registerHerdrTaskSummary;
