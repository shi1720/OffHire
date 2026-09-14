"use client";
import { OperatorSignIn } from "@/components/operator-sign-in";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  AudioLines,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  HardHat,
  LayoutGrid,
  LoaderCircle,
  Phone,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Truck,
  X,
  AlertCircle,
  ReceiptText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  activeStatuses,
  type DeskState,
  type Rental,
  type Scenario,
  type Decision,
} from "@/lib/offhire/types";
import { summarizeRentals } from "@/lib/offhire/decision";

type PublicJob = DeskState["jobs"][number];
type View = "desk" | "calls" | "evidence" | "connection";
type Plan = {
  job: PublicJob;
  plan: {
    task: string;
    recipients: { phones: string[] }[];
    resultSchema: unknown;
  };
};
const scenarios: { id: Scenario; name: string }[] = [
  { id: "confirmed", name: "Supplier confirms off-rent" },
  { id: "ambiguous", name: "Pickup confirmed, billing unclear" },
  { id: "voicemail", name: "Voicemail / no confirmation" },
  { id: "contradiction", name: "A later correction" },
  { id: "unsupported", name: "Unsupported evidence" },
  { id: "wrong_asset", name: "Wrong asset returned" },
];
const money = (value: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
const date = (value: string, timezone = "America/Chicago") =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(value));
const titles: Record<View, string> = {
  desk: "Closeout desk",
  calls: "Call activity",
  evidence: "Evidence ledger",
  connection: "Connection",
};
function statusFor(d: Decision | null, active?: PublicJob) {
  if (active)
    return {
      text:
        active.status === "dispatch_uncertain"
          ? "Submission needs recovery"
          : "Call in progress",
      color: "amber",
    };
  if (!d) return { text: "Ready to verify", color: "amber" };
  return {
    text:
      d.billing === "reported_off_rent"
        ? "Off-rent confirmed"
        : d.disposition === "unreached"
          ? "Not reached"
          : "Needs clarification",
    color: d.billing === "reported_off_rent" ? "green" : "red",
  };
}

export default function Home() {
  const [state, setState] = useState<DeskState | null>(null);
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [view, setView] = useState<View>("desk");
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<
    "new" | "plan" | "receipt" | "record" | "invoice" | "reset" | null
  >(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [approved, setApproved] = useState(false);
  const [scenario, setScenario] = useState<Scenario>("confirmed");
  const [recordAction, setRecordAction] = useState("collected");
  const [invoiceResult, setInvoiceResult] = useState<{
    flagged: boolean;
    reason: string;
  } | null>(null);
  const [receiptJob, setReceiptJob] = useState<PublicJob | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "live")
      setMode("live");
  }, []);
  const api = useCallback(
    async (path: string, data?: unknown) => {
      const res = await fetch(`/api/${path}?mode=${mode}`, {
        method: data === undefined ? "GET" : "POST",
        headers:
          data === undefined ? {} : { "Content-Type": "application/json" },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      const result = (await res.json()) as Record<string, unknown>;
      if (!res.ok)
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "The action could not be completed.",
        );
      return result;
    },
    [mode],
  );
  const load = useCallback(async () => {
    const next = (await api("state")) as DeskState;
    setState(next);
    setSelected((id) =>
      next.rentals.some((r) => r.id === id) ? id : next.rentals[0]?.id || "",
    );
    return next;
  }, [api]);
  useEffect(() => {
    let live = true;
    setState(null);
    setError("");
    api("state")
      .then((raw) => {
        const next = raw as unknown as DeskState;
        return next;
      })
      .then((next) => {
        if (live) {
          setState(next);
          setSelected(next.rentals[0]?.id || "");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [api]);
  const act = async (name: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry the action.");
    } finally {
      setBusy("");
    }
  };
  const rental = state?.rentals.find((r) => r.id === selected) || null;
  const resultFor = (id: string) =>
    state?.jobs.find((j) => j.rentalId === id && j.decision)?.decision || null;
  const currentJob =
    state?.jobs.find((j) => j.rentalId === selected && j.decision) || null;
  const decision = currentJob?.decision || null;
  const active = state?.jobs.find(
    (j) => j.rentalId === selected && activeStatuses.includes(j.status),
  );
  const summary = useMemo(
    () => summarizeRentals(state?.rentals || [], state?.jobs || []),
    [state],
  );
  const visible =
    state?.rentals.filter(
      (r) =>
        filter === "all" ||
        (filter === "attention"
          ? resultFor(r.id)?.billing !== "reported_off_rent"
          : resultFor(r.id)?.billing === "reported_off_rent"),
    ) || [];
  const pollingIds =
    state?.jobs
      .filter((j) =>
        ["queued", "in_progress", "dispatching"].includes(j.status),
      )
      .map((j) => j.id)
      .join(",") || "";
  useEffect(() => {
    if (!pollingIds) return;
    let canceled = false;
    const timer = setTimeout(async () => {
      try {
        for (const id of pollingIds.split(","))
          await api(`jobs/${id}/refresh`, {});
        if (!canceled) await load();
      } catch (e) {
        if (!canceled)
          setError(e instanceof Error ? e.message : "Status refresh failed.");
      }
    }, 5000);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [pollingIds, state, api, load]);
  useEffect(() => {
    type Tool = {
      name: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown;
    };
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: Tool,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools: Tool[] = [
      {
        name: "offhire_get_rentals",
        description:
          "Read the current OffHire rentals and their independently tracked billing and collection states. Makes no calls.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => ({
          mode: stateRef.current?.mode,
          rentals:
            stateRef.current?.rentals.map((r) => ({
              id: r.id,
              assetId: r.assetId,
              supplier: r.supplier,
              collectedAt: r.collectedAt,
              decision: stateRef.current?.jobs.find(
                (j) => j.rentalId === r.id && j.decision,
              )?.decision,
            })) || [],
        }),
      },
      {
        name: "offhire_select_rental",
        description:
          "Select an existing asset in the visible closeout desk. Changes only the selection; it never dispatches a phone call.",
        inputSchema: {
          type: "object",
          properties: { rentalId: { type: "string" } },
          required: ["rentalId"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input) => {
          if (
            typeof input !== "object" ||
            !input ||
            !("rentalId" in input) ||
            typeof input.rentalId !== "string" ||
            !stateRef.current?.rentals.some((r) => r.id === input.rentalId)
          )
            throw new Error("Choose an existing rental ID.");
          setSelected(input.rentalId);
          setView("desk");
          return { selectedRentalId: input.rentalId };
        },
      },
    ];
    for (const tool of tools)
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    return () => lifecycle.abort();
  }, []);
  const openPlan = () =>
    act("plan", async () => {
      if (!rental) return;
      const p = (await api(`rentals/${rental.id}/plan`, {
        scenario,
      })) as unknown as Plan;
      setPlan(p);
      setApproved(false);
      setModal("plan");
    });
  const runPlan = () =>
    act("dispatch", async () => {
      if (!plan) return;
      const res = await api(`jobs/${plan.job.id}/dispatch`, { approved: true });
      await load();
      setModal(null);
      setSelected(plan.job.rentalId);
      setNotice(
        mode === "demo"
          ? "Rehearsal completed. The same evidence checks used for live calls produced this result."
          : (res.job as PublicJob).error ||
              "CALL-E accepted the call. Its saved record will update as results arrive.",
      );
    });
  const openReceipt = (j: PublicJob | null = currentJob) => {
    if (j) {
      setReceiptJob(j);
      setModal("receipt");
    }
  };
  const changeMode = (next: "demo" | "live") => {
    setModal(null);
    setMode(next);
    setView(next === "live" ? "connection" : "desk");
    setNotice("");
  };
  async function createRental(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await act("create", async () => {
      const input = {
        assetId: String(form.get("assetId")),
        name: String(form.get("name")),
        supplier: String(form.get("supplier")),
        contract: String(form.get("contract")),
        site: String(form.get("site")),
        dailyRate: Number(form.get("dailyRate")),
        currency: String(form.get("currency")),
        phone: mode === "demo" ? "" : String(form.get("phone")),
        region: String(form.get("region")),
        timezone: String(form.get("timezone")),
        requestedAt: new Date(String(form.get("requestedAt"))).toISOString(),
        accessNotes: String(form.get("accessNotes")),
        requestNote: String(form.get("requestNote")),
        ready: form.get("ready") === "on",
        authorizedContact: form.get("authorizedContact") === "on",
        isTest: form.get("isTest") === "on",
      };
      const res = await api("rentals", input);
      await load();
      setSelected((res.rental as Rental).id);
      setModal(null);
      setView("desk");
      setNotice(
        "Closeout saved. Preview the exact call plan when you are ready.",
      );
    });
  }
  const switchView = (next: View) => {
    setView(next);
    setError("");
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="OffHire home">
          <span className="brand-mark">
            <ArrowDownRight size={26} />
          </span>
          offhire<span className="brand-period">.</span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">
            {mode === "demo" ? "R" : "O"}
          </span>
          <div>
            {mode === "demo" ? "Riverside build" : "Live workspace"}
            <span>Rental operations</span>
          </div>
          <ChevronRight size={15} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {(
            [
              { id: "desk", icon: LayoutGrid },
              { id: "calls", icon: Phone },
              { id: "evidence", icon: FileText },
            ] as const
          ).map((n) => (
            <button
              key={n.id}
              title={titles[n.id]}
              aria-label={titles[n.id]}
              className={`nav-item ${view === n.id ? "active" : ""}`}
              onClick={() => switchView(n.id)}
            >
              <n.icon size={18} />
              {titles[n.id]}
              {n.id === "desk" && <span>{state?.rentals.length || 0}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="powered">
            <AudioLines size={18} />
            <div>
              Powered by CALL-E<span>Real conversations. Clear records.</span>
            </div>
          </div>
          <button
            className={`nav-item ${view === "connection" ? "active" : ""}`}
            onClick={() => switchView("connection")}
          >
            <Settings2 size={18} />
            Connection
          </button>
          <div className="profile">
            <span>SG</span>
            <div>
              Shivam Gupta<small>Builder & workspace owner</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace</span>
            <ChevronRight size={14} />
            <span>{titles[view]}</span>
          </div>
          <div className="topbar-actions">
            <button
              className={`mode-pill ${mode === "demo" ? "demo" : "live"}`}
              onClick={() => switchView("connection")}
            >
              <span className="mode-light" />
              {mode === "demo" ? "DEMO · SYNTHETIC DATA" : "LIVE WORKSPACE"}
            </button>
            <button
              aria-label="Connection settings"
              className="icon-button mobile-connection"
              onClick={() => switchView("connection")}
            >
              <Settings2 size={18} />
            </button>
          </div>
        </header>
        <main className="desk">
          {error && (
            <div className="banner error" role="alert">
              <AlertCircle size={18} />
              <div>
                {error}
                {!state && (
                  <button
                    className="text-button"
                    onClick={() =>
                      act("reload", async () => {
                        await load();
                      })
                    }
                  >
                    Retry loading
                  </button>
                )}
              </div>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="banner success" role="status">
              <CheckCheck size={18} />
              <div>{notice}</div>
              <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {!state && !error && (
            <div className="loading">
              <LoaderCircle className="spin" />
              <p>Opening your rental desk…</p>
            </div>
          )}
          {!state && mode === "live" && (
            <section className="empty-state">
              <ShieldCheck size={36} />
              <h1>Operator access</h1>
              <p>
                The public demo uses fictional rentals. Live calls and real
                rental records are restricted to approved operators.
              </p>
              <OperatorSignIn />
              <button className="button" onClick={() => changeMode("demo")}>
                Return to demo
              </button>
            </section>
          )}
          {state && view === "desk" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">RENTAL CLOSEOUT</p>
                  <h1>Stop the clock.</h1>
                  <p>The work is finished. Make sure the rental is, too.</p>
                </div>
                <button
                  className="button primary"
                  aria-label="New closeout"
                  onClick={() => setModal("new")}
                >
                  <Plus size={17} />
                  New closeout
                </button>
              </div>
              <div className="metrics">
                <article>
                  <span>Rate awaiting confirmation</span>
                  <strong>
                    {Object.entries(summary.rates).length > 1
                      ? "Mixed"
                      : money(
                          Object.values(summary.rates)[0] || 0,
                          Object.keys(summary.rates)[0] || "USD",
                        )}
                    <small>/ day</small>
                  </strong>
                  <p>
                    <Clock3 size={15} />
                    {summary.unconfirmed}{" "}
                    {summary.unconfirmed === 1 ? "rental" : "rentals"} · entered
                    rates, not savings
                  </p>
                </article>
                <article>
                  <span>Confirmed off-rent</span>
                  <strong>
                    {summary.confirmed}
                    <small>of {state.rentals.length} rentals</small>
                  </strong>
                  <p>
                    <Check size={15} />
                    Supplier-reported cutoff captured
                  </p>
                </article>
                <article>
                  <span>Awaiting pickup</span>
                  <strong>
                    {summary.awaitingPickup}
                    <small>off-rent on site</small>
                  </strong>
                  <p>
                    <Truck size={15} />
                    Collection tracked separately
                  </p>
                </article>
              </div>
              <div className="desk-grid">
                <section className="rentals-panel">
                  <div className="panel-heading">
                    <h2>
                      Closeout queue <span>{state.rentals.length}</span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() =>
                        act("reload", async () => {
                          await load();
                        })
                      }
                      aria-label="Refresh rentals"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                  <div className="filter-tabs" aria-label="Filter rentals">
                    {[
                      {
                        id: "all",
                        title: "All rentals",
                        count: state.rentals.length,
                      },
                      {
                        id: "attention",
                        title: "Needs attention",
                        count: summary.unconfirmed,
                      },
                      {
                        id: "offrent",
                        title: "Off-rent",
                        count: summary.confirmed,
                      },
                    ].map((f) => (
                      <button
                        key={f.id}
                        className={filter === f.id ? "selected" : ""}
                        aria-pressed={filter === f.id}
                        onClick={() => setFilter(f.id)}
                      >
                        {f.title} <span>{f.count}</span>
                      </button>
                    ))}
                  </div>
                  <div className="rental-list">
                    {visible.map((r) => {
                      const d = resultFor(r.id);
                      const status = statusFor(
                        d,
                        state.jobs.find(
                          (j) =>
                            j.rentalId === r.id &&
                            activeStatuses.includes(j.status),
                        ),
                      );
                      return (
                        <button
                          key={r.id}
                          aria-pressed={selected === r.id}
                          className={`rental-row ${selected === r.id ? "selected" : ""}`}
                          onClick={() => {
                            setSelected(r.id);
                            setScenario("confirmed");
                          }}
                        >
                          <div className="asset-icon">
                            {r.name.toLowerCase().includes("light") ? (
                              <AudioLines size={23} />
                            ) : (
                              <HardHat size={23} />
                            )}
                          </div>
                          <div className="rental-main">
                            <div className="asset-id">
                              {r.assetId} <span>· {r.supplier}</span>
                            </div>
                            <h3>{r.name}</h3>
                            <p>{r.site}</p>
                            <span className={`status ${status.color}`}>
                              {status.text}
                            </span>
                            {r.collectedAt && (
                              <span className="collected-tag">
                                <Check size={12} />
                                Collected
                              </span>
                            )}
                          </div>
                          <div className="rental-rate">
                            {money(r.dailyRate, r.currency)}
                            <span>/day</span>
                            <ChevronRight size={18} />
                          </div>
                        </button>
                      );
                    })}
                    {!visible.length && (
                      <div className="empty-list">
                        <HardHat size={30} />
                        <h3>
                          {state.rentals.length
                            ? "Nothing in this view"
                            : "Your first closeout starts here"}
                        </h3>
                        <p>
                          {state.rentals.length
                            ? "Choose another filter to see your rentals."
                            : "Add the asset, supplier and the existing off-rent request."}
                        </p>
                        {!state.rentals.length && (
                          <button
                            className="button"
                            onClick={() => setModal("new")}
                          >
                            Add a rental
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="queue-note">
                    <Clock3 size={16} />
                    <p>
                      A pickup request isn’t an off-rent confirmation.
                      <br />
                      <strong>OffHire keeps the two separate.</strong>
                    </p>
                  </div>
                </section>
                {rental ? (
                  <section className="detail-panel">
                    <div className="detail-heading">
                      <span className="eyebrow">
                        {decision ? "CLOSEOUT RECORD" : "NEXT ACTION"}
                      </span>
                      <span className="asset-id">{rental.assetId}</span>
                    </div>
                    {!decision && !active ? (
                      <>
                        <h2>
                          One call.
                          <br />A clear closeout.
                        </h2>
                        <p className="detail-intro">
                          Confirm the billing cutoff with {rental.supplier},
                          then check collection.
                        </p>
                      </>
                    ) : (
                      <>
                        <h2
                          className={
                            decision?.billing === "reported_off_rent"
                              ? "confirmed-title"
                              : ""
                          }
                        >
                          {active
                            ? "Call in progress."
                            : decision?.billing === "reported_off_rent"
                              ? "Cutoff confirmed.\nReceipt kept."
                              : decision?.pickup === "scheduled"
                                ? "Pickup is booked.\nBilling isn’t clear."
                                : "Keep this one open."}
                        </h2>
                        <p className="detail-intro">
                          {active
                            ? "The call record is saved. A completed call will still need evidence of the billing cutoff."
                            : decision?.nextAction}
                        </p>
                      </>
                    )}
                    <div className="call-route">
                      <span className="call-icon">
                        <Phone size={20} />
                      </span>
                      <div>
                        {rental.supplier}
                        <small>
                          {rental.contract} ·{" "}
                          {mode === "demo"
                            ? "Fictional rental desk"
                            : rental.phone || "Add an approved number"}
                        </small>
                      </div>
                    </div>
                    {decision ? (
                      <div className="outcome-lanes">
                        <div>
                          <span className="lane-icon">
                            <ReceiptText size={17} />
                          </span>
                          <div>
                            <label>Billing cutoff</label>
                            <strong>
                              {decision.offRentAt
                                ? date(decision.offRentAt, rental.timezone)
                                : "Unconfirmed"}
                            </strong>
                            {decision.reference && (
                              <small>Reference {decision.reference}</small>
                            )}
                          </div>
                          <span
                            className={`lane-dot ${decision.offRentAt ? "green" : "amber"}`}
                          />
                        </div>
                        <div>
                          <span className="lane-icon">
                            <Truck size={17} />
                          </span>
                          <div>
                            <label>Collection</label>
                            <strong>
                              {rental.collectedAt
                                ? "Recorded by site team"
                                : decision.pickupWindow ||
                                  "No window confirmed"}
                            </strong>
                            <small>
                              {rental.collectedAt
                                ? date(rental.collectedAt, rental.timezone)
                                : "Asset remains in site custody"}
                            </small>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="call-scope">
                        One asset. Billing cutoff, reference, and collection.
                      </div>
                    )}
                    {active ? (
                      <div className="active-call">
                        <span className="status amber">
                          {active.status.replaceAll("_", " ")}
                        </span>
                        {active.error && <p>{active.error}</p>}
                        <button
                          className="button wide"
                          disabled={!!busy}
                          onClick={() =>
                            act("refresh", async () => {
                              await api(
                                `jobs/${active.id}/${active.status === "dispatch_uncertain" ? "dispatch" : "refresh"}`,
                                active.status === "dispatch_uncertain"
                                  ? { approved: true }
                                  : {},
                              );
                              await load();
                            })
                          }
                        >
                          {active.status === "dispatch_uncertain"
                            ? "Recover original submission"
                            : "Refresh call status"}
                          <RefreshCw size={16} />
                        </button>
                        <small>
                          Refreshing never starts another call. Recovery reuses
                          the original request.
                        </small>
                      </div>
                    ) : (
                      <>
                        {mode === "demo" &&
                          decision?.billing !== "reported_off_rent" && (
                            <label className="scenario-picker">
                              Rehearsal scenario
                              <select
                                value={scenario}
                                onChange={(e) =>
                                  setScenario(e.target.value as Scenario)
                                }
                              >
                                {scenarios.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        {decision && (
                          <button
                            className="button wide receipt-button"
                            onClick={() => openReceipt()}
                          >
                            <FileCheck2 size={17} />
                            View evidence receipt
                            <ArrowUpRight size={17} />
                          </button>
                        )}
                        {decision?.billing !== "reported_off_rent" && (
                          <button
                            className="button primary wide"
                            disabled={!!busy}
                            onClick={openPlan}
                          >
                            {busy === "plan" ? (
                              <LoaderCircle className="spin" size={17} />
                            ) : null}
                            {decision
                              ? "Preview follow-up call"
                              : "Preview call plan"}
                            <ArrowUpRight size={18} />
                          </button>
                        )}
                        {decision?.billing === "reported_off_rent" && (
                          <div className="split-actions">
                            <button
                              className="button"
                              onClick={() => {
                                setInvoiceResult(null);
                                setModal("invoice");
                              }}
                            >
                              <ReceiptText size={15} />
                              Check invoice
                            </button>
                            <button
                              className="button"
                              onClick={() => {
                                setRecordAction("collected");
                                setModal("record");
                              }}
                            >
                              <Check size={15} />
                              Record update
                            </button>
                          </div>
                        )}
                        <p className="quiet-note">
                          {mode === "demo"
                            ? "Rehearsals use fixtures. No phone is dialed."
                            : "Review the plan before a real call. Charges may apply."}
                        </p>
                      </>
                    )}
                  </section>
                ) : (
                  <section className="detail-panel">
                    <h2>Ready when you are.</h2>
                    <p className="detail-intro">
                      Add a rental to turn a missing supplier confirmation into
                      a clear record.
                    </p>
                  </section>
                )}
              </div>
            </>
          )}
          {state && view === "calls" && (
            <>
              <PageHeading
                eyebrow="CALL OPERATIONS"
                title="Every conversation, accounted for."
                description="An accepted call and a confirmed off-rent are separate outcomes."
              />
              <section className="content-panel">
                <div className="panel-heading">
                  <h2>
                    Call activity{" "}
                    <span>
                      {state.jobs.filter((j) => j.status !== "prepared").length}
                    </span>
                  </h2>
                  <button
                    className="button"
                    disabled={!!busy}
                    onClick={() =>
                      act("refresh", async () => {
                        for (const j of state.jobs.filter((j) =>
                          activeStatuses.includes(j.status),
                        ))
                          await api(`jobs/${j.id}/refresh`, {});
                        await load();
                      })
                    }
                  >
                    <RefreshCw size={15} />
                    Refresh
                  </button>
                </div>
                {state.jobs
                  .filter((j) => j.status !== "prepared")
                  .map((j) => {
                    const r = state.rentals.find((r) => r.id === j.rentalId);
                    return (
                      <div className="activity-row" key={j.id}>
                        <span className="call-icon">
                          <Phone size={18} />
                        </span>
                        <div className="activity-main">
                          <strong>
                            {r?.assetId} · {r?.supplier}
                          </strong>
                          <p>
                            {j.decision?.title || j.status.replaceAll("_", " ")}
                          </p>
                          <small>
                            {j.mode === "demo"
                              ? "Synthetic rehearsal"
                              : "Live CALL-E"}{" "}
                            · {date(j.createdAt, r?.timezone)}
                            {j.callId &&
                              ` · ${j.callId.startsWith("sim") ? "Fixture result" : j.callId}`}
                          </small>
                          {j.error && <p className="error-text">{j.error}</p>}
                        </div>
                        <span
                          className={`status ${j.decision?.billing === "reported_off_rent" ? "green" : "amber"}`}
                        >
                          {j.status.replaceAll("_", " ")}
                        </span>
                        {j.decision && (
                          <button
                            className="button"
                            onClick={() => openReceipt(j)}
                          >
                            View receipt
                          </button>
                        )}
                      </div>
                    );
                  })}
                {!state.jobs.some((j) => j.status !== "prepared") && (
                  <div className="empty-list">
                    <Phone size={30} />
                    <h3>No calls yet</h3>
                    <p>Review a rental’s call plan from the closeout desk.</p>
                  </div>
                )}
              </section>
            </>
          )}
          {state && view === "evidence" && (
            <>
              <PageHeading
                eyebrow="AUDIT & FOLLOW-THROUGH"
                title="Keep the receipt."
                description="Supplier statements, collection records, and the context finance needs."
              />
              <div className="ledger-heading">
                <p>
                  {state.jobs.filter((j) => j.decision).length} recorded
                  outcomes ·{" "}
                  {mode === "demo"
                    ? "synthetic evidence"
                    : "supplier-reported evidence"}
                </p>
                <a
                  className="button"
                  href={`/api/export?mode=${mode}`}
                  download
                >
                  <Download size={16} />
                  Export evidence
                </a>
              </div>
              <section className="content-panel">
                {state.rentals.map((r) => {
                  const j = state.jobs.find(
                    (j) => j.rentalId === r.id && j.decision,
                  );
                  return (
                    <div className="evidence-row" key={r.id}>
                      <div>
                        <span className="asset-id">
                          {r.assetId} · {r.contract}
                        </span>
                        <h3>{r.name}</h3>
                        <p>
                          {j?.decision?.reference
                            ? `Off-rent ${j.decision.reference}`
                            : "Off-rent reference outstanding"}
                        </p>
                      </div>
                      <div className="checklist">
                        <span className={j?.decision?.offRentAt ? "done" : ""}>
                          <Check size={14} />
                          Billing:{" "}
                          {j?.decision?.offRentAt ? "confirmed" : "pending"}
                        </span>
                        <span className={r.writtenConfirmation ? "done" : ""}>
                          <FileText size={14} />
                          Written confirmation:{" "}
                          {r.writtenConfirmation ? "received" : "pending"}
                        </span>
                        <span className={r.collectedAt ? "done" : ""}>
                          <Truck size={14} />
                          Collection:{" "}
                          {r.collectedAt ? "recorded" : "awaiting pickup"}
                        </span>
                        <span className={r.invoiceReviewed ? "done" : ""}>
                          <FileText size={14} />
                          Invoice review:{" "}
                          {r.invoiceReviewed ? "recorded" : "pending"}
                        </span>
                      </div>
                      {j ? (
                        <button
                          className="button"
                          onClick={() => openReceipt(j)}
                        >
                          Open receipt
                          <ArrowUpRight size={15} />
                        </button>
                      ) : (
                        <button
                          className="button"
                          onClick={() => {
                            setSelected(r.id);
                            setView("desk");
                          }}
                        >
                          Verify rental
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>
              <p className="footnote">
                A transcript is a record of the conversation. It does not
                replace the supplier’s official written confirmation or
                establish an invoice overcharge.
              </p>
            </>
          )}
          {state && view === "connection" && (
            <>
              <PageHeading
                eyebrow="WORKSPACE CONNECTION"
                title="A clear line to the rental desk."
                description="Explore with sample data, or connect an authorized operator to real calls."
              />
              <div className="connection-grid">
                <section className="content-panel padded">
                  <span className="connection-icon">
                    <AudioLines size={27} />
                  </span>
                  <h2>CALL-E connection</h2>
                  <div className="setting-row">
                    <span>Server API key</span>
                    <span
                      className={`status ${state.connection.configured ? "green" : "amber"}`}
                    >
                      {state.connection.configured
                        ? "Configured"
                        : "Not configured"}
                    </span>
                  </div>
                  <div className="setting-row">
                    <span>Live dispatch</span>
                    <span>
                      {state.connection.liveEnabled
                        ? "Enabled for approved operators"
                        : "Disabled"}
                    </span>
                  </div>
                  <div className="setting-row">
                    <span>Call budget remaining</span>
                    <strong>
                      {state.connection.remainingCalls} /{" "}
                      {state.connection.callLimit}
                    </strong>
                  </div>
                  <p className="footnote">
                    Keys stay on the server. Real calls require an approved
                    operator, an allowed destination, and a reviewed plan.
                    Rehearsals use no CALL-E credits.
                  </p>
                  {mode === "live" && (
                    <button
                      className="button"
                      disabled={!!busy}
                      onClick={() =>
                        act("verify", async () => {
                          await api("connection/verify", {});
                          setNotice(
                            "CALL-E authentication verified. No call was placed.",
                          );
                        })
                      }
                    >
                      Verify connection
                      <ShieldCheck size={16} />
                    </button>
                  )}
                  <a
                    className="external-link"
                    href="https://dashboard.heycall-e.com/account/api-keys"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open CALL-E dashboard
                    <ExternalLink size={14} />
                  </a>
                </section>
                <section className="content-panel padded">
                  <h2>Workspace mode</h2>
                  {state.connection.authProvider === "firebase" &&
                    state.connection.signedIn && (
                      <button
                        className="button"
                        disabled={!!busy}
                        onClick={() =>
                          act("signout", async () => {
                            await api("auth/logout", {});
                            window.location.assign("/");
                          })
                        }
                      >
                        Sign out
                      </button>
                    )}
                  <button
                    className={`mode-card ${mode === "demo" ? "selected" : ""}`}
                    onClick={() => changeMode("demo")}
                  >
                    <Play size={20} />
                    <div>
                      <strong>Demo workspace</strong>
                      <p>
                        Private sample records in this browser session. Six
                        repeatable scenarios; no phone calls.
                      </p>
                    </div>
                    {mode === "demo" && <Check size={18} />}
                  </button>
                  <button
                    className={`mode-card ${mode === "live" ? "selected" : ""}`}
                    onClick={() => changeMode("live")}
                  >
                    <Phone size={20} />
                    <div>
                      <strong>Live workspace</strong>
                      <p>
                        Real CALL-E calls to explicitly authorized contacts.
                        Operator sign-in required.
                      </p>
                    </div>
                    {mode === "live" && <Check size={18} />}
                  </button>
                  {mode === "demo" && (
                    <button
                      className="text-button"
                      onClick={() => setModal("reset")}
                    >
                      <RefreshCw size={14} />
                      Reset sample scenario
                    </button>
                  )}
                  <p className="footnote">
                    One live call at a time. Uncertain submissions stay locked
                    until reconciled. Closing the browser does not cancel a
                    dispatched call.
                  </p>
                </section>
              </div>
              <section className="content-panel padded connection-note">
                <h2>Built for the missing confirmation.</h2>
                <p>
                  Use a supplier portal when it already provides the cutoff and
                  reference. OffHire handles cross-supplier exceptions, records
                  what was actually said, and gives the site team and finance
                  the same receipt.
                </p>
                <a
                  className="external-link"
                  href="https://github.com/shi1720/OffHire"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open source, by Shivam Gupta
                  <ExternalLink size={14} />
                </a>
              </section>
            </>
          )}
          <footer className="desk-footer">
            <span>OFFHIRE / BUILT BY SHIVAM GUPTA</span>
            <span>Close the rental. Keep the receipt.</span>
          </footer>
        </main>
      </div>
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setModal(null);
        }}
      >
        <DialogContent
          className={`offhire-modal ${modal === "receipt" ? "receipt-modal" : ""}`}
        >
          {modal === "new" && (
            <>
              <DialogTitle>New rental closeout</DialogTitle>
              <DialogDescription>
                Enter one asset with an existing off-rent request.{" "}
                {mode === "demo"
                  ? "Use fictional details in this demo."
                  : "The site lead must authorize readiness and contact."}
              </DialogDescription>
              <form onSubmit={createRental} className="rental-form">
                <div className="form-grid">
                  <Field
                    label="Asset ID"
                    name="assetId"
                    placeholder="SL-305"
                    required
                  />
                  <Field
                    label="Equipment"
                    name="name"
                    placeholder="26′ scissor lift"
                    required
                  />
                  <Field
                    label="Supplier"
                    name="supplier"
                    placeholder="Rental company"
                    required
                  />
                  <Field
                    label="Rental contract"
                    name="contract"
                    placeholder="CR-12045"
                    required
                  />
                  <Field
                    label="Site / location"
                    name="site"
                    placeholder="Project · collection point"
                    required
                  />
                  <Field
                    label="Entered daily rate"
                    name="dailyRate"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue="185"
                    required
                  />
                  <label>
                    Currency
                    <select name="currency" defaultValue="USD">
                      {["USD", "GBP", "INR", "SGD", "AUD"].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Supplier region
                    <select name="region" defaultValue="US">
                      {["US", "GB", "IN", "SG", "AU", "CA"].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Supplier timezone
                    <select name="timezone" defaultValue="America/Chicago">
                      {[
                        "America/Chicago",
                        "America/New_York",
                        "America/Los_Angeles",
                        "Europe/London",
                        "Asia/Kolkata",
                        "Asia/Singapore",
                        "Australia/Sydney",
                      ].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <Field
                    label="Request submitted (your local time)"
                    name="requestedAt"
                    type="datetime-local"
                    defaultValue={new Date(
                      Date.now() - new Date().getTimezoneOffset() * 60000,
                    )
                      .toISOString()
                      .slice(0, 16)}
                    required
                  />
                  {mode === "live" && (
                    <Field
                      label="Approved phone number"
                      name="phone"
                      type="tel"
                      placeholder="+14155550123"
                      required
                    />
                  )}
                </div>
                <label>
                  Existing off-rent request
                  <textarea
                    name="requestNote"
                    placeholder="When and how was the return requested? What confirmation is missing?"
                    required
                    minLength={5}
                    maxLength={800}
                  />
                </label>
                <label>
                  Collection access notes
                  <textarea
                    name="accessNotes"
                    placeholder="Staging point, staffed access, and the site lead’s instructions."
                    maxLength={500}
                  />
                </label>
                <label className="checkbox-row">
                  <input name="ready" type="checkbox" required />
                  The site lead confirms this asset is ready for return.
                </label>
                {mode === "live" && (
                  <>
                    <label className="checkbox-row">
                      <input
                        name="authorizedContact"
                        type="checkbox"
                        required
                      />
                      I have permission to contact this exact destination about
                      this rental.
                    </label>
                    <label className="checkbox-row">
                      <input name="isTest" type="checkbox" />
                      Owned-number roleplay test; no real rental will be
                      changed.
                    </label>
                  </>
                )}
                <button
                  className="button primary"
                  type="submit"
                  disabled={!!busy}
                >
                  {busy === "create" ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Plus size={17} />
                  )}
                  Save closeout
                </button>
              </form>
            </>
          )}
          {modal === "plan" && plan && (
            <>
              <DialogTitle>
                {mode === "demo"
                  ? "Rehearse the call plan"
                  : "Review the live call plan"}
              </DialogTitle>
              <DialogDescription>
                {mode === "demo"
                  ? "This uses a labeled fixture and the production evidence checks. No phone is dialed."
                  : "This will place one real CALL-E call. Review the destination, scope and questions."}
              </DialogDescription>
              <div className="plan-target">
                <Phone size={22} />
                <div>
                  <strong>{rental?.supplier}</strong>
                  <span>
                    {mode === "demo" ? "Synthetic rental desk" : rental?.phone}{" "}
                    · {rental?.assetId} · {rental?.contract}
                  </span>
                </div>
                <span className="status amber">
                  {mode === "demo" ? "REHEARSAL" : "REAL CALL"}
                </span>
              </div>
              <div className="plan-summary">
                <h3>One asset. Three explicit answers.</h3>
                <ol>
                  <li>
                    Verify the exact asset and rental contract with the rental
                    desk.
                  </li>
                  <li>
                    Confirm the billing cutoff, timezone and off-rent reference;
                    read them back.
                  </li>
                  <li>
                    Confirm collection separately and ask for written
                    confirmation.
                  </li>
                </ol>
                <p>
                  No purchases, fees, alternate assets or changes to contract
                  terms are authorized.
                </p>
              </div>
              <details>
                <summary>Read the complete agent instructions</summary>
                <pre className="plan-text">{plan.plan.task}</pre>
              </details>
              <details>
                <summary>View structured result schema</summary>
                <pre className="plan-text">
                  {JSON.stringify(plan.plan.resultSchema, null, 2)}
                </pre>
              </details>
              {mode === "live" && (
                <label className="checkbox-row consent">
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={(e) => setApproved(e.target.checked)}
                  />
                  I approve this exact destination and call scope. This plan
                  expires after 15 minutes and the call may incur usage charges.
                </label>
              )}
              <button
                className="button primary wide"
                disabled={!!busy || (mode === "live" && !approved)}
                onClick={runPlan}
              >
                {busy === "dispatch" ? (
                  <LoaderCircle className="spin" size={17} />
                ) : mode === "demo" ? (
                  <Play size={17} />
                ) : (
                  <Phone size={17} />
                )}{" "}
                {mode === "demo" ? "Run rehearsal" : "Place approved call"}
                <ArrowUpRight size={18} />
              </button>
              <p className="footnote">
                {mode === "demo"
                  ? `Scenario: ${scenarios.find((s) => s.id === scenario)?.name}.`
                  : `Approval expires ${date(plan.job.grantExpiresAt, rental?.timezone)}. Once accepted, this API cannot cancel a call.`}
              </p>
            </>
          )}
          {modal === "receipt" && receiptJob && (
            <Receipt
              job={receiptJob}
              rental={
                state?.rentals.find((r) => r.id === receiptJob.rentalId) || null
              }
              onRecord={() => {
                setSelected(receiptJob.rentalId);
                setRecordAction("written_confirmation");
                setModal("record");
              }}
            />
          )}
          {modal === "record" && rental && (
            <>
              <DialogTitle>Record a site update</DialogTitle>
              <DialogDescription>
                {rental.assetId} · {rental.supplier}. This records a human
                observation; it does not change the supplier’s billing system.
              </DialogDescription>
              <form
                className="rental-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void act("record", async () => {
                    await api(`rentals/${rental.id}/record`, {
                      action: recordAction,
                      note: String(form.get("note")),
                    });
                    await load();
                    setModal(null);
                    setNotice("Update saved to the audit record.");
                  });
                }}
              >
                <label>
                  What happened?
                  <select
                    value={recordAction}
                    onChange={(e) => setRecordAction(e.target.value)}
                  >
                    <option value="collected">
                      Site team confirms physical collection
                    </option>
                    <option value="written_confirmation">
                      Supplier’s written confirmation received
                    </option>
                    <option value="invoice_reviewed">
                      Finance completed invoice review
                    </option>
                  </select>
                </label>
                <label>
                  Who confirmed it, and what is the reference?
                  <textarea
                    name="note"
                    required
                    minLength={3}
                    maxLength={500}
                    placeholder="Site lead / email reference / invoice review note"
                  />
                </label>
                <button className="button primary" disabled={!!busy}>
                  Save record
                  <Check size={17} />
                </button>
              </form>
            </>
          )}
          {modal === "invoice" && rental && (
            <>
              <DialogTitle>Check the invoice end date</DialogTitle>
              <DialogDescription>
                Compare the billed-through date against the supplier-reported
                cutoff for {rental.assetId}.
              </DialogDescription>
              <form
                className="rental-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void act("invoice", async () => {
                    setInvoiceResult(
                      (await api(`rentals/${rental.id}/invoice`, {
                        billedThrough: String(form.get("billedThrough")),
                      })) as unknown as { flagged: boolean; reason: string },
                    );
                  });
                }}
              >
                <Field
                  label="Invoice billed through"
                  name="billedThrough"
                  type="date"
                  defaultValue="2026-09-15"
                  required
                />
                <button className="button primary" disabled={!!busy}>
                  Compare dates
                  <ReceiptText size={17} />
                </button>
              </form>
              {invoiceResult && (
                <div
                  className={`invoice-result ${invoiceResult.flagged ? "flagged" : ""}`}
                  role="status"
                >
                  <strong>
                    {invoiceResult.flagged
                      ? "Send to finance for review"
                      : "Date check complete"}
                  </strong>
                  <p>{invoiceResult.reason}</p>
                </div>
              )}
              <p className="footnote">
                Minimum rental periods, rate tiers and collection charges may
                explain differences. OffHire does not file a dispute or claim a
                refund.
              </p>
            </>
          )}
          {modal === "reset" && (
            <>
              <DialogTitle>Reset the sample workspace?</DialogTitle>
              <DialogDescription>
                This replaces only this browser session’s fictional rentals and
                rehearsals with the original three-asset example.
              </DialogDescription>
              <div className="split-actions">
                <button className="button" onClick={() => setModal(null)}>
                  Keep current demo
                </button>
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={() =>
                    act("reset", async () => {
                      await api("reset", {});
                      await load();
                      setFilter("all");
                      setModal(null);
                      setView("desk");
                      setNotice("Original sample scenario restored.");
                    })
                  }
                >
                  Reset demo
                  <RefreshCw size={15} />
                </button>
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="modal-error">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label>
      {label}
      <input {...props} />
    </label>
  );
}
function Receipt({
  job,
  rental,
  onRecord,
}: {
  job: PublicJob;
  rental: Rental | null;
  onRecord: () => void;
}) {
  const d = job.decision;
  return (
    <>
      <DialogTitle>Closeout evidence receipt</DialogTitle>
      <DialogDescription>
        {rental?.assetId} · {rental?.supplier} ·{" "}
        {job.mode === "demo"
          ? "Synthetic rehearsal"
          : "Live CALL-E conversation"}
      </DialogDescription>
      <div
        className={`receipt-verdict ${d?.billing === "reported_off_rent" ? "confirmed" : ""}`}
      >
        <ShieldCheck size={25} />
        <div>
          <span className="eyebrow">
            {job.mode === "demo"
              ? "FIXTURE RESULT"
              : "SUPPLIER-REPORTED RESULT"}
          </span>
          <h2>{d?.title}</h2>
          <p>{d?.nextAction}</p>
        </div>
      </div>
      <div className="receipt-facts">
        <div>
          <span>Off-rent cutoff</span>
          <strong>
            {d?.offRentAt
              ? date(d.offRentAt, rental?.timezone)
              : "Not confirmed"}
          </strong>
        </div>
        <div>
          <span>Off-rent reference</span>
          <strong>{d?.reference || "Not confirmed"}</strong>
        </div>
        <div>
          <span>Collection</span>
          <strong>
            {rental?.collectedAt
              ? "Recorded by site team"
              : d?.pickupWindow || "Not confirmed"}
          </strong>
        </div>
        <div>
          <span>Written confirmation</span>
          <strong>
            {rental?.writtenConfirmation
              ? "Receipt recorded by operator"
              : "Still to be received"}
          </strong>
        </div>
      </div>
      {!!d?.reasons.length && (
        <section className="review-reasons">
          <h3>Why this stays open</h3>
          <ul>
            {d.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="evidence-quotes">
        <h3>What the rental desk said</h3>
        {d?.evidence.length ? (
          d.evidence.map((e, i) => (
            <article key={`${e.field}-${i}`}>
              <label>
                {e.field}
                <span>Transcript turn {e.turn + 1}</span>
              </label>
              <blockquote>“{e.quote}”</blockquote>
            </article>
          ))
        ) : (
          <p>
            No supported rental-desk statement was available. The result stays
            unconfirmed.
          </p>
        )}
      </section>
      <details className="transcript">
        <summary>
          Read full {job.mode === "demo" ? "synthetic " : ""}transcript (
          {d?.transcript.length || 0} turns)
        </summary>
        {d?.transcript.map((t, i) => (
          <div key={i} className={`transcript-turn ${t.speaker}`}>
            <span>
              {t.speaker === "bot"
                ? "OFFHIRE"
                : t.speaker === "user"
                  ? "RENTAL DESK"
                  : "UNKNOWN SPEAKER"}
              {t.offset_seconds !== null ? ` · ${t.offset_seconds}s` : ""}
            </span>
            <p>{t.text}</p>
          </div>
        ))}
      </details>
      <div className="receipt-end">
        <p>
          CALL-E task:{" "}
          <strong>
            {job.snapshot?.taskCompleted ? "completed" : "not completed"}
          </strong>{" "}
          · Billing cutoff:{" "}
          <strong>{d?.offRentAt ? "confirmed" : "unconfirmed"}</strong>
        </p>
        <small>
          Quoted evidence is matched to complete callee turns. This is a
          conversation record, not the supplier’s official confirmation or proof
          of savings.
        </small>
      </div>
      <div className="split-actions">
        <button className="button" onClick={() => window.print()}>
          <FileText size={16} />
          Print receipt
        </button>
        <button className="button primary" onClick={onRecord}>
          Record follow-through
          <Check size={16} />
        </button>
      </div>
    </>
  );
}
