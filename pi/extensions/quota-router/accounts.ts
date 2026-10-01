import type { AuthInteraction, Credential } from "@earendil-works/pi-ai";

/**
 * Multiple logins for one Pi provider.
 *
 * Pi keys `auth.json` by provider id and resolves every request through that single entry.
 * The active account therefore stays under the provider id (`openai-codex`); other accounts
 * are parked under `openai-codex@<label>`. Activating an account moves credentials between
 * those keys, so each token set exists exactly once and Pi's own refresh keeps it valid.
 * Which label currently occupies the provider key, which one the user prefers, and shared
 * cooldowns live in a small state file outside Git.
 */

// Display-only invalidation; no credentials or account identities travel on the bus.
export const ACCOUNTS_CHANGED_EVENT = "quota-router:accounts-changed";
export const DEFAULT_LABEL = "main";
const LABEL_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeLabel(label: unknown): string | undefined {
  const value = typeof label === "string" ? label.trim().toLowerCase() : "";
  return LABEL_PATTERN.test(value) ? value : undefined;
}

export function parkedKey(provider: string, label: string): string {
  return `${provider}@${label}`;
}

export function parseParkedKey(key: string): { provider: string; label: string } | undefined {
  const at = key.indexOf("@");
  if (at <= 0 || at === key.length - 1) return undefined;
  return { provider: key.slice(0, at), label: key.slice(at + 1) };
}

export interface Cooldown {
  until: number;
  reason: string;
}

export interface ProviderState {
  active: string;
  /** Label to return to once its cooldown passes; absent when the user chose the active one. */
  preferred?: string;
}

export interface RouterState {
  providers: Record<string, ProviderState>;
  /** Keyed by `provider@label`, shared by every Pi session on this machine. */
  cooldowns: Record<string, Cooldown>;
}

export function emptyState(): RouterState {
  return { providers: {}, cooldowns: {} };
}

export function parseState(text: string | undefined): RouterState {
  const state = emptyState();
  if (!text) return state;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return state;
  }
  if (!parsed || typeof parsed !== "object") return state;
  const record = parsed as Record<string, unknown>;
  if (record.providers && typeof record.providers === "object") {
    for (const [provider, value] of Object.entries(record.providers as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      const active = normalizeLabel(entry.active);
      if (!active) continue;
      const preferred = normalizeLabel(entry.preferred);
      state.providers[provider] = preferred && preferred !== active ? { active, preferred } : { active };
    }
  }
  if (record.cooldowns && typeof record.cooldowns === "object") {
    for (const [key, value] of Object.entries(record.cooldowns as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      if (typeof entry.until === "number" && Number.isFinite(entry.until) && entry.until > 0) {
        state.cooldowns[key] = { until: entry.until, reason: typeof entry.reason === "string" ? entry.reason : "limit" };
      }
    }
  }
  return state;
}

/** Credential keys and the provider login flow; the real backend wraps Pi's locked auth store. */
export interface AccountsBackend {
  read(key: string): Promise<Credential | undefined>;
  /** Replace the credential under `key`, returning what was stored before. */
  swap(key: string, next: Credential): Promise<Credential | undefined>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
  /** Run the provider's own OAuth login and persist the credential under `key`. */
  login(provider: string, key: string, interaction: AuthInteraction): Promise<Credential>;
  /** Whether the provider is a built-in OAuth provider whose login can be shared. */
  supportsLogin(provider: string): boolean;
}

/** State persistence plus a cross-process lock around account moves. */
export interface StateStore {
  read(): RouterState;
  write(state: RouterState): void;
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

export interface AccountSlot {
  label: string;
  active: boolean;
  cooldown?: Cooldown;
}

export interface AccountSummary {
  provider: string;
  /** Undefined when nothing is signed in under the provider id. */
  active?: string;
  slots: AccountSlot[];
}

export interface Activation {
  provider: string;
  from?: string;
  to: string;
}

export interface AccountStoreOptions {
  backend: AccountsBackend;
  state: StateStore;
  now?: () => number;
}

export class AccountStore {
  private readonly backend: AccountsBackend;
  private readonly state: StateStore;
  private readonly now: () => number;

  constructor(options: AccountStoreOptions) {
    this.backend = options.backend;
    this.state = options.state;
    this.now = options.now ?? (() => Date.now());
  }

  readState(): RouterState {
    return this.state.read();
  }

  /** Label occupying the provider key according to state; `main` until a move happens. */
  activeLabel(provider: string): string {
    return this.state.read().providers[provider]?.active ?? DEFAULT_LABEL;
  }

  preferredLabel(provider: string): string | undefined {
    return this.state.read().providers[provider]?.preferred;
  }

  cooldown(provider: string, label: string): Cooldown | undefined {
    const entry = this.state.read().cooldowns[parkedKey(provider, label)];
    return entry && entry.until > this.now() ? entry : undefined;
  }

  async parkedLabels(provider: string): Promise<string[]> {
    const labels: string[] = [];
    for (const key of await this.backend.keys()) {
      const parsed = parseParkedKey(key);
      if (parsed?.provider === provider) labels.push(parsed.label);
    }
    return labels.sort();
  }

  async summary(provider: string): Promise<AccountSummary> {
    const keys = await this.backend.keys();
    const hasActive = keys.includes(provider);
    const active = hasActive ? this.activeLabel(provider) : undefined;
    const slots: AccountSlot[] = [];
    if (active) slots.push({ label: active, active: true, cooldown: this.cooldown(provider, active) });
    for (const label of await this.parkedLabels(provider)) {
      slots.push({ label, active: false, cooldown: this.cooldown(provider, label) });
    }
    return { provider, active, slots };
  }

  /** Providers with an active or parked credential that has a label, for listing. */
  async providers(): Promise<string[]> {
    const providers = new Set<string>();
    for (const key of await this.backend.keys()) {
      const parsed = parseParkedKey(key);
      if (parsed) providers.add(parsed.provider);
    }
    for (const provider of Object.keys(this.state.read().providers)) providers.add(provider);
    return [...providers].sort();
  }

  /**
   * First parked account whose cooldown has passed, in label order. The active label is
   * excluded by construction (it is not parked).
   */
  async next(provider: string): Promise<string | undefined> {
    for (const label of await this.parkedLabels(provider)) {
      if (!this.cooldown(provider, label)) return label;
    }
    return undefined;
  }

  /** Credential for a label: the provider key while active, the parked key otherwise. */
  async readCredential(provider: string, label: string): Promise<Credential | undefined> {
    const keys = await this.backend.keys();
    if (keys.includes(provider) && this.activeLabel(provider) === label) return this.backend.read(provider);
    return this.backend.read(parkedKey(provider, label));
  }

  markCooldown(provider: string, label: string, until: number, reason: string): void {
    const state = this.state.read();
    state.cooldowns[parkedKey(provider, label)] = { until, reason };
    for (const [key, entry] of Object.entries(state.cooldowns)) {
      if (entry.until <= this.now()) delete state.cooldowns[key];
    }
    this.state.write(state);
  }

  clearCooldowns(provider?: string): void {
    const state = this.state.read();
    for (const key of Object.keys(state.cooldowns)) {
      if (!provider || parseParkedKey(key)?.provider === provider) delete state.cooldowns[key];
    }
    this.state.write(state);
  }

  setPreferred(provider: string, preferred: string | undefined): void {
    const state = this.state.read();
    const entry = state.providers[provider] ?? { active: DEFAULT_LABEL };
    if (preferred && preferred !== entry.active) entry.preferred = preferred;
    else delete entry.preferred;
    state.providers[provider] = entry;
    this.state.write(state);
  }

  /** Sign in another account for `provider` through its own OAuth flow and park it. */
  async add(provider: string, rawLabel: string, interaction: AuthInteraction): Promise<{ label: string; credential: Credential }> {
    const label = normalizeLabel(rawLabel);
    if (!label) throw new Error(`Invalid label ${JSON.stringify(rawLabel)}: use letters, digits and dashes`);
    if (!this.backend.supportsLogin(provider)) throw new Error(`${provider} is not a built-in OAuth provider`);
    const keys = await this.backend.keys();
    if (keys.includes(parkedKey(provider, label))) throw new Error(`${provider} already has an account labelled ${label}`);
    if (keys.includes(provider) && this.activeLabel(provider) === label) {
      throw new Error(`${label} is the label of the account currently signed in as ${provider}`);
    }
    const credential = await this.backend.login(provider, parkedKey(provider, label), interaction);
    return { label, credential };
  }

  /**
   * Make the parked account `label` the one under the provider key. Runs under the shared
   * lock; a concurrent activation of the same label becomes a no-op. The previously active
   * credential is parked first so no token set is ever the only copy in flight, and a
   * refresh Pi performed in between is re-parked from the value the swap observed.
   */
  async activate(provider: string, rawLabel: string, options: { preferred?: string | null } = {}): Promise<Activation | undefined> {
    const label = normalizeLabel(rawLabel);
    if (!label) throw new Error(`Invalid label ${JSON.stringify(rawLabel)}`);
    return this.state.withLock(async () => {
      const state = this.state.read();
      const entry = state.providers[provider] ?? { active: DEFAULT_LABEL };
      const keys = await this.backend.keys();
      const hasActive = keys.includes(provider);
      if (hasActive && entry.active === label) return undefined;
      const incoming = await this.backend.read(parkedKey(provider, label));
      if (!incoming) throw new Error(`${provider} has no parked account labelled ${label}`);

      const from = hasActive ? entry.active : undefined;
      if (hasActive) {
        const current = await this.backend.read(provider);
        if (current) await this.backend.swap(parkedKey(provider, from!), current);
        const observed = await this.backend.swap(provider, incoming);
        if (observed && current && !sameCredential(observed, current)) {
          await this.backend.swap(parkedKey(provider, from!), observed);
        }
      } else {
        await this.backend.swap(provider, incoming);
      }
      await this.backend.remove(parkedKey(provider, label));

      entry.active = label;
      if (options.preferred === null) delete entry.preferred;
      else if (options.preferred !== undefined) entry.preferred = options.preferred;
      if (entry.preferred === label) delete entry.preferred;
      state.providers[provider] = entry;
      this.state.write(state);
      return { provider, from, to: label };
    });
  }

  /** Forget a parked account. The active account is removed with Pi's own `/logout`. */
  async remove(provider: string, rawLabel: string): Promise<void> {
    const label = normalizeLabel(rawLabel);
    if (!label) throw new Error(`Invalid label ${JSON.stringify(rawLabel)}`);
    return this.state.withLock(async () => {
      const keys = await this.backend.keys();
      if (!keys.includes(parkedKey(provider, label))) {
        if (keys.includes(provider) && this.activeLabel(provider) === label) {
          throw new Error(`${label} is the active ${provider} account; use /logout to sign it out`);
        }
        throw new Error(`${provider} has no parked account labelled ${label}`);
      }
      await this.backend.remove(parkedKey(provider, label));
      const state = this.state.read();
      delete state.cooldowns[parkedKey(provider, label)];
      if (state.providers[provider]?.preferred === label) delete state.providers[provider].preferred;
      this.state.write(state);
    });
  }
}

function sameCredential(a: Credential, b: Credential): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Codex tokens carry the ChatGPT account id; use it to warn about duplicate logins. */
export function accountIdentity(credential: Credential | undefined): string | undefined {
  if (!credential || credential.type !== "oauth") return undefined;
  const record = credential as unknown as Record<string, unknown>;
  return typeof record.accountId === "string" ? record.accountId : undefined;
}
