// PROTOTYPE — throwaway. Not production code: no tests, no error handling, no abstractions.
//
// Question: "What does the Notification Feed look like in Cadence?"
// (https://github.com/qbrossard/cohort-005-project/issues/13)
//
// Plan: three variants of the Notification Feed, mounted in the real app layout and
// switchable via `?variant=`, all reading the live Knock feed of the DevUI-selected user.
//
//   A  Bell popover   bell in the sidebar header · badge = UNSEEN count, clears on open ·
//                     a row is read when clicked · toast when one arrives
//   B  Inbox drawer   "Notifications" nav item · pill = UNREAD count, stays until dealt with ·
//                     drawer with Unread/All tabs · explicit mark read/unread + archive
//   C  Full page      "Notifications" nav item with a dot · own page grouped by day ·
//                     looking at the page reads everything, no state to manage by hand

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NavLink, useFetcher, useNavigate, useSearchParams } from "react-router";
import Knock, { type Feed, type FeedItem, type FeedMetadata } from "@knocklabs/client";
import { Popover } from "radix-ui";
import { toast } from "sonner";
import {
  Archive,
  ArrowRight,
  Bell,
  Check,
  Circle,
  GraduationCap,
  Inbox,
  MessageSquare,
  Receipt,
  Reply,
  UsersRound,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import {
  PrototypeSwitcher,
  type PrototypeVariant,
} from "~/components/prototype-switcher";

export const VARIANTS: PrototypeVariant[] = [
  { key: "A", name: "Bell popover" },
  { key: "B", name: "Inbox drawer" },
  { key: "C", name: "Full page" },
];
type VariantKey = "A" | "B" | "C";

interface FeedConfig {
  publicKey: string;
  feedChannelId: string;
  userId: string;
  userToken: string;
}

// ---------------------------------------------------------------------------
// The catalogue, as the feed sees it
// ---------------------------------------------------------------------------

type Group = "refunds" | "discussion" | "people";

const KINDS: Record<
  string,
  { label: string; icon: typeof Bell; tone: string; cta: string; group: Group }
> = {
  refund_request_raised: {
    label: "Refund Request raised",
    icon: Receipt,
    tone: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    cta: "Open refund queue",
    group: "refunds",
  },
  refund_request_approved: {
    label: "Refund Request approved",
    icon: Check,
    tone: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    cta: "View course",
    group: "refunds",
  },
  refund_request_declined: {
    label: "Refund Request declined",
    icon: X,
    tone: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    cta: "View course",
    group: "refunds",
  },
  new_question: {
    label: "New Question",
    icon: MessageSquare,
    tone: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    cta: "Answer it",
    group: "discussion",
  },
  new_reply: {
    label: "New Reply",
    icon: Reply,
    tone: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    cta: "View reply",
    group: "discussion",
  },
  new_enrollment: {
    label: "New Enrollment",
    icon: GraduationCap,
    tone: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    cta: "View students",
    group: "people",
  },
  seat_claimed: {
    label: "Seat claimed",
    icon: UsersRound,
    tone: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    cta: "View team",
    group: "people",
  },
};
const FALLBACK_KIND = {
  label: "Notification",
  icon: Bell,
  tone: "bg-muted text-muted-foreground",
  cta: "Open",
  group: "people" as Group,
};

function view(item: FeedItem) {
  const d = (item.data ?? {}) as Record<string, string | undefined>;
  const actor = item.actors[0] as { name?: string | null; avatar?: string | null } | undefined;
  return {
    kind: KINDS[d.kind ?? ""] ?? FALLBACK_KIND,
    text: d.text ?? "(no text)",
    excerpt: d.excerpt,
    url: d.url ?? "/",
    actorName: actor?.name ?? "Cadence",
    actorAvatar: actor?.avatar ?? null,
    unread: !item.read_at,
    unseen: !item.seen_at,
  };
}

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// Live Knock feed, shared by every variant
// ---------------------------------------------------------------------------

const EMPTY_META: FeedMetadata = { total_count: 0, unread_count: 0, unseen_count: 0 };

interface FeedCtx {
  variant: VariantKey;
  connected: boolean;
  loading: boolean;
  items: FeedItem[];
  metadata: FeedMetadata;
  feed: Feed | null;
  open: (item: FeedItem) => void;
}
const Ctx = createContext<FeedCtx | null>(null);

function useFeed() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("NotificationFeedPrototypeProvider missing");
  return ctx;
}

const STORAGE_KEY = "cadence-prototype-feed-variant";

export function NotificationFeedPrototypeProvider({
  config,
  children,
}: {
  config: FeedConfig | null;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // `?variant=` wins; without it, stick with the last one used so that navigating
  // around the app (which drops the param) doesn't snap back to A.
  const param = searchParams.get("variant");
  const [remembered, setRemembered] = useState<string>("A");
  useEffect(() => {
    try {
      if (param) localStorage.setItem(STORAGE_KEY, param);
      else setRemembered(localStorage.getItem(STORAGE_KEY) ?? "A");
    } catch {}
  }, [param]);
  const raw = param ?? remembered;
  const variant = (VARIANTS.some((v) => v.key === raw) ? raw : "A") as VariantKey;
  const variantRef = useRef(variant);
  variantRef.current = variant;

  const [feed, setFeed] = useState<Feed | null>(null);
  const [state, setState] = useState({
    items: [] as FeedItem[],
    metadata: EMPTY_META,
    loading: true,
  });

  const userId = config?.userId;
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const c = configRef.current;
    if (!c) return;
    const knock = new Knock(c.publicKey);
    knock.authenticate(c.userId, c.userToken);
    const f = knock.feeds.initialize(c.feedChannelId, { page_size: 30 });
    const unsubscribe = f.store.subscribe((s) =>
      setState({ items: s.items, metadata: s.metadata, loading: s.loading })
    );
    f.on("items.received.realtime", ({ items }: { items: FeedItem[] }) => {
      if (variantRef.current !== "A") return; // only A toasts
      for (const item of items) {
        const v = view(item);
        toast(v.text, {
          description: v.excerpt,
          action: { label: v.kind.cta, onClick: () => openRef.current(item) },
        });
      }
    });
    f.listenForUpdates();
    f.fetch();
    setFeed(f);
    return () => {
      unsubscribe();
      f.teardown();
      knock.teardown();
      setFeed(null);
      setState({ items: [], metadata: EMPTY_META, loading: true });
    };
  }, [userId]);

  function open(item: FeedItem) {
    feed?.markAsRead(item);
    navigate(view(item).url);
  }
  const openRef = useRef(open);
  openRef.current = open;

  const value = useMemo<FeedCtx>(
    () => ({ variant, connected: !!config, feed, open, ...state }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variant, config, feed, state]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <PrototypeSwitcher
        variants={VARIANTS}
        current={variant}
        onChange={(key) =>
          setSearchParams(
            (prev) => {
              prev.set("variant", key);
              return prev;
            },
            { replace: true, preventScrollReset: true }
          )
        }
      >
        <PrototypeControls />
      </PrototypeSwitcher>
    </Ctx.Provider>
  );
}

// State readout + levers, living in the switcher bar (not part of the design).
function PrototypeControls() {
  const { connected, metadata, feed } = useFeed();
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const send = (kind: string) =>
    fetcher.submit({ kind }, { method: "post", action: "/api/prototype-notify" });

  if (!connected) {
    return (
      <span className="text-amber-300">
        no feed: pick a user in the DevUI (and check the KNOCK_ keys in .env)
      </span>
    );
  }

  return (
    <>
      <span className="text-zinc-400">
        unseen <b className="text-zinc-100">{metadata.unseen_count}</b> · unread{" "}
        <b className="text-zinc-100">{metadata.unread_count}</b> · total{" "}
        <b className="text-zinc-100">{metadata.total_count}</b>
      </span>
      <select
        value=""
        onChange={(e) => e.target.value && send(e.target.value)}
        className="rounded-full bg-zinc-800 px-2 py-1"
      >
        <option value="">Send me…</option>
        <option value="burst">A burst for my role</option>
        {Object.entries(KINDS).map(([key, k]) => (
          <option key={key} value={key}>
            {k.label}
          </option>
        ))}
      </select>
      <button
        onClick={() => feed?.markAllAsArchived()}
        className="rounded-full bg-zinc-800 px-2 py-1 hover:bg-zinc-700"
      >
        Clear feed
      </button>
      {fetcher.state !== "idle" && <span className="text-zinc-400">sending…</span>}
      {fetcher.data?.ok === false && (
        <span className="max-w-64 truncate text-red-300" title={fetcher.data.error}>
          {fetcher.data.error}
        </span>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sidebar mount points: the layout asks which variant goes where
// ---------------------------------------------------------------------------

export function SidebarHeaderSlot() {
  const { variant } = useFeed();
  return variant === "A" ? <VariantA /> : null;
}

export function SidebarNavSlot() {
  const { variant } = useFeed();
  if (variant === "B") return <VariantB />;
  if (variant === "C") return <VariantCNavItem />;
  return null;
}

const navItemClass = (active: boolean) =>
  cn(
    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
  );

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
      <Bell className="size-6 opacity-40" />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A — Bell popover
// ---------------------------------------------------------------------------

function VariantA() {
  const { items, metadata, loading, feed, open } = useFeed();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={(next) => {
        setIsOpen(next);
        // Opening the feed is "seeing" it: the badge clears, rows stay unread.
        if (next && metadata.unseen_count > 0) feed?.markAllAsSeen();
      }}
    >
      <Popover.Trigger asChild>
        <button
          className="relative rounded-md p-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent"
          aria-label="Notifications"
        >
          <Bell className="size-4" />
          {metadata.unseen_count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
              {metadata.unseen_count > 9 ? "9+" : metadata.unseen_count}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          className="z-50 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
        >
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              onClick={() => feed?.markAllAsRead()}
              disabled={metadata.unread_count === 0}
              className="text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
            >
              Mark all as read
            </button>
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {!loading && items.length === 0 && (
              <EmptyState>You're all caught up.</EmptyState>
            )}
            {items.map((item) => {
              const v = view(item);
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setIsOpen(false);
                    open(item);
                  }}
                  className="flex w-full items-start gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-accent"
                >
                  <UserAvatar
                    name={v.actorName}
                    avatarUrl={v.actorAvatar}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "line-clamp-2 text-sm",
                        v.unread ? "font-medium" : "text-muted-foreground"
                      )}
                    >
                      {v.text}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {timeAgo(item.inserted_at)}
                    </p>
                  </div>
                  {v.unread && (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500" />
                  )}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---------------------------------------------------------------------------
// B — Inbox drawer
// ---------------------------------------------------------------------------

function VariantB() {
  const { items, metadata, loading, feed, open } = useFeed();
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<"unread" | "all">("unread");

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  const shown = tab === "unread" ? items.filter((i) => !i.read_at) : items;

  return (
    <>
      <button onClick={() => setIsOpen((o) => !o)} className={navItemClass(isOpen)}>
        <Inbox className="size-4" />
        Notifications
        {metadata.unread_count > 0 && (
          <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary-foreground">
            {metadata.unread_count}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-y-0 left-56 right-0 z-40 bg-black/20"
            onClick={() => setIsOpen(false)}
          />
          <section className="fixed inset-y-0 left-56 z-50 flex w-[26rem] flex-col border-r bg-background text-foreground shadow-2xl">
            <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
              <h2 className="font-semibold">Notifications</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
              {(["unread", "all"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-md px-3 py-1 text-sm capitalize",
                    tab === t
                      ? "bg-accent font-medium"
                      : "text-muted-foreground hover:bg-accent/50"
                  )}
                >
                  {t}
                  {t === "unread" && ` (${metadata.unread_count})`}
                </button>
              ))}
              <button
                onClick={() => feed?.markAllAsRead()}
                disabled={metadata.unread_count === 0}
                className="ml-auto text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              >
                Mark all as read
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {!loading && shown.length === 0 && (
                <EmptyState>
                  {tab === "unread" ? "Nothing unread." : "No Notifications yet."}
                </EmptyState>
              )}
              {shown.map((item) => {
                const v = view(item);
                const Icon = v.kind.icon;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "group relative border-b",
                      v.unread && "bg-primary/5"
                    )}
                  >
                    <button
                      onClick={() => {
                        setIsOpen(false);
                        open(item);
                      }}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/60"
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md",
                          v.kind.tone
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                          <span className="font-medium uppercase tracking-wide">
                            {v.kind.label}
                          </span>
                          <span className="shrink-0 group-hover:invisible">
                            {timeAgo(item.inserted_at)}
                          </span>
                        </div>
                        <p className={cn("mt-0.5 text-sm", v.unread && "font-semibold")}>
                          {v.text}
                        </p>
                        {v.excerpt && (
                          <p className="mt-1.5 line-clamp-2 border-l-2 pl-2 text-sm text-muted-foreground">
                            {v.excerpt}
                          </p>
                        )}
                      </div>
                    </button>
                    <div className="absolute right-3 top-2 hidden gap-1 rounded-md border bg-background p-0.5 shadow-sm group-hover:flex">
                      <button
                        title={v.unread ? "Mark as read" : "Mark as unread"}
                        onClick={() =>
                          v.unread ? feed?.markAsRead(item) : feed?.markAsUnread(item)
                        }
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {v.unread ? (
                          <Check className="size-3.5" />
                        ) : (
                          <Circle className="size-3.5" />
                        )}
                      </button>
                      <button
                        title="Archive"
                        onClick={() => feed?.markAsArchived(item)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Archive className="size-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// C — Full page
// ---------------------------------------------------------------------------

export const VARIANT_C_PATH = "/prototype/notifications";

function VariantCNavItem() {
  const { metadata } = useFeed();
  return (
    <NavLink to={VARIANT_C_PATH} className={({ isActive }) => navItemClass(isActive)}>
      <Bell className="size-4" />
      Notifications
      {metadata.unseen_count > 0 && (
        <span className="ml-auto size-2 rounded-full bg-red-500" />
      )}
    </NavLink>
  );
}

const FILTERS: { key: "all" | Group; label: string }[] = [
  { key: "all", label: "All" },
  { key: "refunds", label: "Refunds" },
  { key: "discussion", label: "Discussion" },
  { key: "people", label: "Enrollments & Seats" },
];

function dayLabel(iso: string) {
  const d = new Date(iso);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.ceil((startOfToday.getTime() - d.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Earlier this week";
  return "Older";
}

export function VariantCPage() {
  const { variant, items, loading, feed, open } = useFeed();
  const [filter, setFilter] = useState<"all" | Group>("all");

  // Looking at the page reads everything. Rows that were unread when they first showed
  // up here keep a "New" marker for the rest of the visit, so you can still tell them apart.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    const unread = items.filter((i) => !i.read_at);
    if (unread.length === 0 || !feed) return;
    setFresh((prev) => new Set([...prev, ...unread.map((i) => i.id)]));
    const t = setTimeout(() => {
      feed.markAllAsSeen();
      feed.markAllAsRead();
    }, 1500);
    return () => clearTimeout(t);
  }, [items, feed]);

  const shown = items.filter((i) => filter === "all" || view(i).kind.group === filter);
  const groups: { label: string; items: FeedItem[] }[] = [];
  for (const item of shown) {
    const label = dayLabel(item.inserted_at);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      {variant !== "C" && (
        <p className="mb-4 rounded-md border border-dashed border-fuchsia-400 p-3 text-sm text-muted-foreground">
          This page only exists in variant C. You're looking at variant {variant}.
        </p>
      )}
      <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Things other people did that concern you.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              filter === f.key
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!loading && shown.length === 0 && <EmptyState>Nothing here yet.</EmptyState>}

      {groups.map((group) => (
        <section key={group.label} className="mt-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h2>
          <div className="overflow-hidden rounded-lg border bg-card">
            {group.items.map((item) => {
              const v = view(item);
              const Icon = v.kind.icon;
              const isNew = fresh.has(item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => open(item)}
                  className={cn(
                    "group flex w-full items-start gap-4 border-b border-l-2 border-l-transparent px-4 py-4 text-left last:border-b-0 hover:bg-accent/50",
                    isNew && "border-l-primary"
                  )}
                >
                  <div className="relative shrink-0">
                    <UserAvatar
                      name={v.actorName}
                      avatarUrl={v.actorAvatar}
                      className="size-10"
                    />
                    <span
                      className={cn(
                        "absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full ring-2 ring-card",
                        v.kind.tone
                      )}
                    >
                      <Icon className="size-3" />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {v.text}
                      {isNew && (
                        <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                          New
                        </span>
                      )}
                    </p>
                    {v.excerpt && (
                      <p className="mt-1.5 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                        {v.excerpt}
                      </p>
                    )}
                    <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
                      {v.kind.cta} <ArrowRight className="size-3" />
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {timeAgo(item.inserted_at)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
