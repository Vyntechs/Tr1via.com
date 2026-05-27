// Founder Dashboard — client overlay.
//
// Two sections:
//   1. "Comp a host" form. Submit POSTs /api/admin/hosts which creates an
//      auth.users row + a hosts row with is_paywall_bypassed=true.
//      Optimistic insert into the local list on success.
//   2. Hosts table. Per-row toggle PATCHes /api/admin/hosts/[id]. Founder
//      row is rendered first with a special "FOUNDER" badge and no toggle
//      (paywall doesn't apply to the founder by definition).

"use client";

import { useMemo, useState, type FormEvent } from "react";
import { LaptopShell } from "@/components/shells";
import {
  Display,
  Eyebrow,
  Wordmark,
  useTheme,
} from "@/components/system";

export interface AdminHostRow {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  default_venue: string | null;
  role: "host" | "founder";
  is_paywall_bypassed: boolean;
  comped_at: string | null;
  comped_by: string | null;
  comped_by_name: string | null;
  created_at: string;
}

export function HostAdminClient({
  meDisplayName,
  initialHosts,
}: {
  meDisplayName: string;
  initialHosts: AdminHostRow[];
}) {
  return (
    <LaptopShell>
      <Inner meDisplayName={meDisplayName} initialHosts={initialHosts} />
    </LaptopShell>
  );
}

function Inner({ meDisplayName, initialHosts }: { meDisplayName: string; initialHosts: AdminHostRow[] }) {
  const { t } = useTheme();
  const [hosts, setHosts] = useState<AdminHostRow[]>(initialHosts);

  const [founder, others] = useMemo(() => {
    const f = hosts.find((h) => h.role === "founder");
    const o = hosts.filter((h) => h.role !== "founder");
    return [f ?? null, o];
  }, [hosts]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "32px 56px 48px",
        gap: 32,
        overflow: "auto",
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
        <div>
          <Wordmark size={26} />
          <Eyebrow color={t.accent} size={11} style={{ marginTop: 12, display: "block" }}>
            FOUNDER · DASHBOARD
          </Eyebrow>
          <Display size={56} color={t.ink} weight={700} tracking={-0.035} style={{ marginTop: 8, display: "block", lineHeight: 0.95 }}>
            Welcome,
            <br />
            <span style={{ color: t.accent }}>{meDisplayName.split(" ")[0]}.</span>
          </Display>
        </div>
        <div style={{ textAlign: "right", color: t.inkMid, fontSize: 13, lineHeight: 1.5 }}>
          {hosts.length} host{hosts.length === 1 ? "" : "s"}
          <br />
          {hosts.filter((h) => h.is_paywall_bypassed).length} comped
        </div>
      </header>

      <CompForm
        onCreated={(row) => {
          setHosts((prev) => {
            // De-dupe by id in case the API returned an existing host
            const filtered = prev.filter((p) => p.id !== row.id);
            return [row, ...filtered];
          });
        }}
      />

      <GrantLinkForm />

      {founder && (
        <section>
          <Eyebrow color={t.inkMid} size={10}>YOU</Eyebrow>
          <div style={{ marginTop: 10 }}>
            <HostCard host={founder} onToggle={null} />
          </div>
        </section>
      )}

      <section>
        <Eyebrow color={t.inkMid} size={10}>
          ALL HOSTS · {others.length}
        </Eyebrow>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          {others.length === 0 ? (
            <div
              style={{
                padding: "24px 18px",
                borderRadius: 12,
                background: t.surface,
                border: `1px dashed ${t.line}`,
                color: t.inkMid,
                fontSize: 14,
              }}
            >
              No other hosts yet. Comp one above and they&apos;ll show up here.
            </div>
          ) : (
            others.map((h) => (
              <HostCard
                key={h.id}
                host={h}
                onToggle={async (next) => {
                  const prev = hosts;
                  setHosts((curr) =>
                    curr.map((c) => (c.id === h.id ? { ...c, is_paywall_bypassed: next } : c)),
                  );
                  const res = await fetch(`/api/admin/hosts/${h.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ isPaywallBypassed: next }),
                  });
                  if (!res.ok) {
                    setHosts(prev);
                  }
                }}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function CompForm({ onCreated }: { onCreated: (row: AdminHostRow) => void }) {
  const { t } = useTheme();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [venue, setVenue] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "success"; email: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "submitting") return;
    if (!email.trim() || !displayName.trim()) return;
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/admin/hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          displayName: displayName.trim(),
          defaultVenue: venue.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setState({ kind: "error", message: body?.error ?? `request failed (${res.status})` });
        return;
      }
      const body = (await res.json()) as { host: AdminHostRow };
      onCreated(body.host);
      setState({ kind: "success", email: email.trim() });
      setEmail("");
      setDisplayName("");
      setVenue("");
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "network error",
      });
    }
  }

  const submitting = state.kind === "submitting";

  return (
    <section
      style={{
        padding: "24px 24px 22px",
        borderRadius: 16,
        background: t.surface,
        border: `1px solid ${t.line}`,
      }}
    >
      <Eyebrow color={t.accent} size={11}>COMP A HOST</Eyebrow>
      <p style={{ color: t.inkMid, fontSize: 14, lineHeight: 1.5, marginTop: 8, marginBottom: 18 }}>
        Create the host&apos;s account with the paywall bypassed. They sign in at
        tr1via.com/login with this email — magic link, no extra confirmation.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
        <Field
          label="Email"
          value={email}
          onChange={setEmail}
          placeholder="host@theirplace.com"
          type="email"
          required
          disabled={submitting}
        />
        <Field
          label="Display name"
          value={displayName}
          onChange={setDisplayName}
          placeholder="Linda Petrov"
          required
          disabled={submitting}
        />
        <Field
          label="Default venue"
          value={venue}
          onChange={setVenue}
          placeholder="Soul Fire Pizza"
          disabled={submitting}
        />
        <button
          type="submit"
          disabled={submitting || !email.trim() || !displayName.trim()}
          style={{
            padding: "14px 22px",
            background: t.accent,
            color: "#FFF",
            border: "none",
            borderRadius: 12,
            fontFamily: "var(--font-sans)",
            fontSize: 15,
            fontWeight: 700,
            cursor: submitting ? "default" : "pointer",
            opacity: submitting ? 0.6 : 1,
            boxShadow: `0 14px 30px -10px ${t.accent}66`,
            whiteSpace: "nowrap",
          }}
        >
          {submitting ? "Comping…" : "Comp host  →"}
        </button>
      </form>

      {state.kind === "success" && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: 10,
            background: `${t.correct}22`,
            color: t.ink,
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          ✓ Comped <strong>{state.email}</strong>. They can sign in at tr1via.com/login now.
        </div>
      )}
      {state.kind === "error" && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: 10,
            background: `${t.wrong}22`,
            color: t.wrong,
            fontSize: 13,
            lineHeight: 1.4,
            fontWeight: 600,
          }}
        >
          {state.message}
        </div>
      )}
    </section>
  );
}

/**
 * Founder-only tool: generate a one-click sign-in URL for any registered
 * host and hand it to them out-of-band (text, AirDrop). Solves the
 * Supabase magic-link rate limit + email-deliverability friction that
 * stalled the first host on 2026-05-25 the day before her go-live.
 *
 * Out of scope here: creating brand-new hosts (use "Comp a host" above).
 * The endpoint returns 404 for emails that aren't already registered.
 */
function GrantLinkForm() {
  const { t } = useTheme();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "ready"; url: string; email: string; displayName: string | null }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "sending") return;
    const trimmed = email.trim();
    if (!trimmed) return;
    setState({ kind: "sending" });
    setCopied(false);
    try {
      const res = await fetch("/api/admin/grant-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const body = (await res.json().catch(() => null)) as
        | { url?: string; email?: string; displayName?: string | null; error?: string }
        | null;
      if (!res.ok || !body?.url) {
        setState({
          kind: "error",
          message: body?.error ?? `request failed (${res.status})`,
        });
        return;
      }
      setState({
        kind: "ready",
        url: body.url,
        email: body.email ?? trimmed,
        displayName: body.displayName ?? null,
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "network error",
      });
    }
  }

  async function handleCopy() {
    if (state.kind !== "ready") return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // clipboard blocked — user can still select-copy manually
    }
  }

  const sending = state.kind === "sending";

  return (
    <section
      style={{
        padding: "24px 24px 22px",
        borderRadius: 16,
        background: t.surface,
        border: `1px solid ${t.line}`,
      }}
    >
      <Eyebrow color={t.accent} size={11}>SEND A SIGN-IN LINK</Eyebrow>
      <p style={{ color: t.inkMid, fontSize: 14, lineHeight: 1.5, marginTop: 8, marginBottom: 18 }}>
        Generate a one-click URL for any host. Text it to them — they
        click it and land on their dashboard signed in. No email check,
        no rate limit. Link expires in about an hour.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "end" }}>
        <Field
          label="Host email"
          value={email}
          onChange={setEmail}
          placeholder="host@theirplace.com"
          type="email"
          required
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !email.trim()}
          style={{
            padding: "14px 22px",
            background: t.accent,
            color: "#FFF",
            border: "none",
            borderRadius: 12,
            fontFamily: "var(--font-sans)",
            fontSize: 15,
            fontWeight: 700,
            cursor: sending ? "default" : "pointer",
            opacity: sending ? 0.6 : 1,
            boxShadow: `0 14px 30px -10px ${t.accent}66`,
            whiteSpace: "nowrap",
          }}
        >
          {sending ? "Generating…" : "Generate link  →"}
        </button>
      </form>

      {state.kind === "ready" && (
        <div
          style={{
            marginTop: 14,
            padding: "14px 16px",
            borderRadius: 12,
            background: `${t.correct}11`,
            border: `1px solid ${t.correct}55`,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 13, color: t.ink, lineHeight: 1.4 }}>
            ✓ Link ready for <strong>{state.email}</strong>
            {state.displayName ? ` (${state.displayName})` : ""}. Text or
            AirDrop this URL — when they tap it, they land signed in.
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
            <code
              data-testid="grant-link-url"
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 8,
                background: t.paper,
                border: `1px solid ${t.line}`,
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                color: t.ink,
                wordBreak: "break-all",
                lineHeight: 1.4,
                userSelect: "all",
              }}
            >
              {state.url}
            </code>
            <button
              type="button"
              onClick={() => void handleCopy()}
              data-testid="grant-link-copy"
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                border: `1px solid ${t.line}`,
                background: copied ? t.correct : t.paper,
                color: copied ? "#FFF" : t.ink,
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: 10,
            background: `${t.wrong}22`,
            color: t.wrong,
            fontSize: 13,
            lineHeight: 1.4,
            fontWeight: 600,
          }}
        >
          {state.message}
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTheme();
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: t.inkMute, fontWeight: 600 }}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        style={{
          padding: "12px 14px",
          fontSize: 15,
          fontFamily: "var(--font-sans)",
          fontWeight: 500,
          color: t.ink,
          background: t.paper,
          border: `1px solid ${t.line}`,
          borderRadius: 10,
          outline: "none",
        }}
      />
    </label>
  );
}

function HostCard({
  host,
  onToggle,
}: {
  host: AdminHostRow;
  onToggle: ((next: boolean) => Promise<void>) | null;
}) {
  const { t } = useTheme();
  const compedDate = host.comped_at ? new Date(host.comped_at).toLocaleDateString() : null;
  const isFounder = host.role === "founder";

  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 12,
        background: t.surface,
        border: `1px solid ${isFounder ? t.accent : t.line}`,
        display: "grid",
        gridTemplateColumns: "1.4fr 1fr 0.9fr auto",
        gap: 16,
        alignItems: "center",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.ink, letterSpacing: "-0.01em" }}>
          {host.display_name}
        </div>
        <div style={{ fontSize: 12, color: t.inkMid, marginTop: 2, fontFamily: "var(--font-mono)", letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {host.email}
        </div>
      </div>

      <div style={{ fontSize: 13, color: t.inkMid }}>
        {host.default_venue ?? <span style={{ color: t.inkMute }}>—</span>}
      </div>

      <div style={{ fontSize: 12, color: t.inkMid, lineHeight: 1.4 }}>
        {isFounder ? (
          <RoleBadge label="FOUNDER" color={t.accent} />
        ) : host.is_paywall_bypassed ? (
          <div>
            <RoleBadge label="COMPED" color={t.correct} />
            {compedDate && (
              <div style={{ marginTop: 4, fontSize: 11, color: t.inkMute }}>
                {compedDate}{host.comped_by_name && ` by ${host.comped_by_name}`}
              </div>
            )}
          </div>
        ) : (
          <RoleBadge label="STANDARD" color={t.inkMute} />
        )}
      </div>

      <div>
        {onToggle && !isFounder ? (
          <Toggle value={host.is_paywall_bypassed} onChange={(v) => void onToggle(v)} />
        ) : (
          <div style={{ width: 56, height: 30 }} />
        )}
      </div>
    </div>
  );
}

function RoleBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 8px",
        borderRadius: 999,
        background: `${color}22`,
        color,
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.12em",
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  const { t } = useTheme();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      style={{
        width: 56,
        height: 30,
        borderRadius: 999,
        border: "none",
        background: value ? t.correct : t.line,
        position: "relative",
        cursor: "pointer",
        transition: "background .15s",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: value ? 30 : 3,
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "#FFF",
          transition: "left .15s",
          boxShadow: "0 1px 2px rgba(0,0,0,.2)",
        }}
      />
    </button>
  );
}
