import type { SavedAccount } from "../../features/account/accounts";
import { post } from "../bus";
import * as store from "../store";
import { Empty } from "../ui/Empty";
import { Icon, IconButton } from "../ui/Icon";
import { Loading } from "../ui/Loading";
import { QuotaCard } from "../usage/QuotaCard";
import { UsageGlance } from "../usage/UsageGlance";

/** A stable colour per person, from VS Code's chart palette. */
const HUES = ["blue", "purple", "green", "orange", "red", "yellow"] as const;
function hue(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--vscode-charts-${HUES[h % HUES.length]})`;
}

function Avatar({ name, seed, small = false }: { name: string; seed: string; small?: boolean }) {
  return (
    <span
      class={`avatar${small ? " small" : ""}`}
      style={{ background: hue(seed) }}
      aria-hidden="true"
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function SavedRow({ a, inUse }: { a: SavedAccount; inUse: boolean }) {
  return (
    <li class={`acct-row${inUse ? " in-use" : ""}`}>
      <Avatar name={a.name} seed={a.id} small />
      <div class="acct-text">
        <span class="acct-name">{a.name}</span>
        <span class="acct-sub">{[a.email, a.plan].filter(Boolean).join(" · ")}</span>
        {a.lastSeen ? <span class="acct-seen">Last seen {a.lastSeen}</span> : null}
      </div>
      {inUse ? (
        <span class="badge ok">In use</span>
      ) : (
        <button
          type="button"
          class="btn secondary small"
          aria-label={`Switch to ${a.email}`}
          disabled={!store.account.value?.canSwitch}
          onClick={() => post({ type: "account:switch", id: a.id })}
        >
          Switch
        </button>
      )}
      <IconButton
        icon="trash"
        label={`Forget ${a.email}`}
        onClick={() => post({ type: "account:remove", id: a.id })}
      />
    </li>
  );
}

/** Who's signed in, saved accounts to switch between, plan limits and usage at a glance. */
export function AccountView() {
  const s = store.account.value;
  if (!s) {
    return (
      <section class="account scroll">
        <Loading text="Reading your account…" retry={{ type: "refresh" }} />
      </section>
    );
  }
  const p = s.profile;
  const saved = p ? s.saved.some((a) => a.id === p.id) : false;
  const planClass = p?.plan ? `plan-${p.plan.split(" ")[0]!.toLowerCase()}` : "";
  return (
    <section class="account scroll">
      {s.broken ? (
        <div class="banner error" role="alert">
          <Icon name="error" />
          <div>
            <b>Claude Code's settings file looks broken.</b> ~/.claude.json is empty or not valid,
            so Claude may ask you to log in again and forget its settings.
            {s.broken.backup ? (
              <button
                type="button"
                class="btn small"
                onClick={() => post({ type: "account:restoreConfig" })}
              >
                Restore from backup
              </button>
            ) : (
              <span> No backup was found to restore from.</span>
            )}
          </div>
        </div>
      ) : null}
      {p ? (
        <section class="card profile" aria-labelledby="profile-name">
          <div class="profile-head">
            <button
              type="button"
              class="avatar-btn"
              title="Switch account"
              aria-label="Switch account"
              onClick={() => post({ type: "account:pick" })}
            >
              <Avatar name={p.name} seed={p.id} />
            </button>
            <div class="profile-text">
              <h2 id="profile-name" class="profile-name">
                {p.name}
              </h2>
              <span class="profile-email">{p.email}</span>
              {p.organization ? (
                <span class="profile-org">
                  {p.organization}
                  {p.role ? ` · ${p.role}` : ""}
                </span>
              ) : null}
            </div>
            {p.plan ? <span class={`plan-badge ${planClass}`}>{p.plan}</span> : null}
          </div>
          {s.signInDays !== null && s.signInDays !== undefined ? (
            <p class="profile-meta">
              {s.signInDays === 0
                ? "Your sign-in has run out: log in again."
                : `Signed in for ${s.signInDays} more day${s.signInDays === 1 ? "" : "s"}`}
            </p>
          ) : null}
          <div class="profile-actions">
            <button type="button" class="btn" onClick={() => post({ type: "account:pick" })}>
              <Icon name="arrow-swap" /> Switch account
            </button>
            {saved ? null : (
              <button
                type="button"
                class="btn secondary"
                disabled={!s.canSwitch}
                title={s.canSwitch ? undefined : "Orbit can't reach Claude Code's sign-in here"}
                onClick={() => post({ type: "account:save" })}
              >
                <Icon name="save" /> Save this account
              </button>
            )}
            <button
              type="button"
              class="btn secondary danger"
              onClick={() => post({ type: "account:logout" })}
            >
              <Icon name="sign-out" /> Log out
            </button>
          </div>
        </section>
      ) : (
        <Empty
          icon="account"
          title="Not signed in"
          action={{ label: "Log in", onClick: () => post({ type: "account:login" }) }}
        >
          {s.saved.length
            ? "Switch to a saved account below, or log in. A terminal opens to sign you in."
            : "Log in to Claude Code with your Claude account. A terminal opens to sign you in."}
        </Empty>
      )}

      <section class="card" aria-labelledby="saved-title">
        <div class="card-head">
          <h3 id="saved-title" class="section-title">
            Saved accounts
          </h3>
          <span class="card-meta">{s.saved.length || ""}</span>
        </div>
        {s.saved.length ? (
          <ul class="acct-list">
            {s.saved.map((a) => (
              <SavedRow key={a.id} a={a} inUse={a.id === p?.id} />
            ))}
          </ul>
        ) : (
          <p class="card-text">
            Use more than one Claude account? Save each one here, then switch with one click, no
            logging in again.
          </p>
        )}
        {s.canSwitch ? (
          <p class="card-hint">
            <Icon name="lock" /> Kept in VS Code's encrypted storage on this computer. Nothing
            leaves your machine.
          </p>
        ) : (
          <p class="card-hint">
            <Icon name="info" /> On this computer Claude Code keeps its sign-in in the system
            keychain, so one-click switching isn't available. Log in with another account instead.
          </p>
        )}
        <button type="button" class="link-btn" onClick={() => post({ type: "account:login" })}>
          Log in with another account
        </button>
      </section>

      <QuotaCard />
      <UsageGlance />
    </section>
  );
}
