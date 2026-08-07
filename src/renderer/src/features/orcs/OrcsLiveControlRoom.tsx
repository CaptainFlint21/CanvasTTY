import { useEffect, useMemo, useState } from "react";
import type { CanvasTTYApi, LocaleId } from "../../../../shared/contracts";
import type {
  OrcsDesktopApiHost,
  OrcsDesktopSnapshotResult
} from "../../../../shared/orcsBridge";
import type {
  OrcsCheckStatus,
  OrcsEventLevel,
  OrcsRoleId,
  OrcsRoleStatus,
  OrcsSnapshot
} from "../../../../shared/orcs";
import { OrcsControlRoom } from "./OrcsControlRoom";

const POLL_INTERVAL_MS = 2_000;
const DEV_MOCK_ENABLED = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get("orcsMock") === "1";

const ROLE_LABELS: Record<LocaleId, Record<OrcsRoleId, string>> = {
  ru: {
    moderator: "Модератор",
    architect: "Архитектор",
    coder: "Кодер",
    critic: "Критик",
    judge: "Судья"
  },
  en: {
    moderator: "Moderator",
    architect: "Architect",
    coder: "Coder",
    critic: "Critic",
    judge: "Judge"
  }
};

const ROLE_STATUS_LABELS: Record<LocaleId, Record<OrcsRoleStatus, string>> = {
  ru: {
    idle: "ожидает",
    working: "работает",
    waiting: "ждёт",
    needs_approval: "нужно решение",
    done: "готово",
    failed: "ошибка"
  },
  en: {
    idle: "idle",
    working: "working",
    waiting: "waiting",
    needs_approval: "needs approval",
    done: "done",
    failed: "failed"
  }
};

const CHECK_LABELS: Record<LocaleId, Record<OrcsCheckStatus, string>> = {
  ru: {
    pending: "ожидает",
    running: "идёт",
    passed: "пройдено",
    failed: "ошибка",
    skipped: "пропущено"
  },
  en: {
    pending: "pending",
    running: "running",
    passed: "passed",
    failed: "failed",
    skipped: "skipped"
  }
};

const COPY = {
  ru: {
    title: "ORCS Control Room",
    open: "Открыть ORCS Control Room",
    close: "Закрыть ORCS Control Room",
    currentTask: "Текущая задача",
    phase: "Фаза",
    approval: "Контрольная точка",
    roles: "Команда",
    verification: "Проверки",
    timeline: "События",
    fallback: "резерв",
    tools: "инструментов",
    source: "Источник",
    loading: "Подключение к локальному ORCS…",
    unavailable: "Локальный ORCS недоступен",
    live: "Live · только чтение",
    stale: "Последний snapshot устарел",
    readOnlyLive: "Только чтение · данные получены через локальный Unix socket",
    readOnlyStale: "Только чтение · показан последний валидный snapshot"
  },
  en: {
    title: "ORCS Control Room",
    open: "Open ORCS Control Room",
    close: "Close ORCS Control Room",
    currentTask: "Current task",
    phase: "Phase",
    approval: "Approval gate",
    roles: "Team",
    verification: "Verification",
    timeline: "Timeline",
    fallback: "fallback",
    tools: "tools",
    source: "Source",
    loading: "Connecting to local ORCS…",
    unavailable: "Local ORCS is unavailable",
    live: "Live · read-only",
    stale: "Last snapshot is stale",
    readOnlyLive: "Read-only · data received through the local Unix socket",
    readOnlyStale: "Read-only · showing the last valid snapshot"
  }
} as const;

type ViewState = "loading" | OrcsDesktopSnapshotResult["state"];

export function OrcsLiveControlRoom(): React.JSX.Element {
  if (DEV_MOCK_ENABLED) return <OrcsControlRoom />;
  return <LiveControlRoom />;
}

function LiveControlRoom(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [locale, setLocale] = useState<LocaleId>(
    navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en"
  );
  const [state, setState] = useState<ViewState>("loading");
  const [snapshot, setSnapshot] = useState<OrcsSnapshot | null>(null);
  const copy = COPY[locale];
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(
    locale === "ru" ? "ru-RU" : "en-US",
    { hour: "2-digit", minute: "2-digit", second: "2-digit" }
  ), [locale]);

  useEffect(() => {
    let cancelled = false;
    void window.canvasTTY.settings.get()
      .then((settings) => {
        if (!cancelled) setLocale(settings.locale);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const host = window.canvasTTY as CanvasTTYApi & OrcsDesktopApiHost;

    const refresh = async (): Promise<void> => {
      try {
        const result = await host.orcs.getSnapshot();
        if (cancelled) return;
        setState(result.state);
        setSnapshot(result.snapshot);
      } catch {
        if (cancelled) return;
        setState((current) => current === "available" || current === "stale" ? "stale" : "unavailable");
        setSnapshot((current) => current ? { ...current, stale: true } : null);
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const subtitle = state === "available"
    ? copy.live
    : state === "stale"
      ? copy.stale
      : state === "loading"
        ? copy.loading
        : copy.unavailable;

  return (
    <div
      className={`orcs-control ${open ? "orcs-control--open" : ""}`}
      data-interactive="true"
      data-orcs-state={state}
    >
      <button
        className="orcs-control__toggle"
        type="button"
        aria-expanded={open}
        aria-controls="orcs-control-room"
        aria-label={open ? copy.close : copy.open}
        title={`${open ? copy.close : copy.open} · ${subtitle}`}
        onClick={() => setOpen((value) => !value)}
      >
        <strong>ORCS</strong>
        <span className="orcs-control__toggle-state" aria-hidden="true" />
      </button>

      <aside
        id="orcs-control-room"
        className="orcs-control__panel"
        aria-hidden={!open}
        aria-label={copy.title}
      >
        <header className="orcs-control__header">
          <div>
            <span className="orcs-control__eyebrow">{subtitle}</span>
            <h2>{copy.title}</h2>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label={copy.close}>×</button>
        </header>

        {snapshot ? (
          <SnapshotContent snapshot={snapshot} locale={locale} timeFormatter={timeFormatter} />
        ) : (
          <section className="orcs-control__summary">
            <div className="orcs-control__task">
              <span>{copy.currentTask}</span>
              <strong>{state === "loading" ? copy.loading : copy.unavailable}</strong>
              <small>{copy.source}: daemon</small>
            </div>
          </section>
        )}

        <footer className="orcs-control__footer">
          {state === "stale" ? copy.readOnlyStale : copy.readOnlyLive}
        </footer>
      </aside>
    </div>
  );
}

function SnapshotContent({
  snapshot,
  locale,
  timeFormatter
}: {
  snapshot: OrcsSnapshot;
  locale: LocaleId;
  timeFormatter: Intl.DateTimeFormat;
}): React.JSX.Element {
  const copy = COPY[locale];
  return (
    <>
      <section className="orcs-control__summary">
        <div className="orcs-control__task">
          <span>{copy.currentTask}</span>
          <strong>{snapshot.taskTitle ?? "—"}</strong>
          <small>
            {copy.source}: {snapshot.source}
            {snapshot.headSha ? ` · ${snapshot.headSha.slice(0, 8)}` : ""}
          </small>
        </div>
        <div className="orcs-control__summary-stat">
          <span>{copy.phase}</span>
          <strong>{snapshot.phase}</strong>
        </div>
        <div className={`orcs-control__summary-stat orcs-control__summary-stat--${snapshot.gate.status}`}>
          <span>{copy.approval}</span>
          <strong>{snapshot.gate.status}</strong>
        </div>
      </section>

      <section className="orcs-control__section">
        <h3>{copy.roles}</h3>
        <div className="orcs-control__roles">
          {snapshot.roles.map((role) => (
            <article className={`orcs-role orcs-role--${role.status}`} key={role.role}>
              <header>
                <span className="orcs-role__mark">{ROLE_LABELS[locale][role.role].slice(0, 1)}</span>
                <div>
                  <strong>{ROLE_LABELS[locale][role.role]}</strong>
                  <span>{ROLE_STATUS_LABELS[locale][role.status]}</span>
                </div>
              </header>
              <p>{role.summary}</p>
              <footer>
                <span>{role.model}</span>
                <span>{role.toolCalls} {copy.tools}</span>
                {role.fallbackLevel > 0 && <span>{copy.fallback} {role.fallbackLevel}</span>}
              </footer>
            </article>
          ))}
        </div>
      </section>

      <div className="orcs-control__lower-grid">
        <section className="orcs-control__section">
          <h3>{copy.verification}</h3>
          <div className="orcs-checks">
            {snapshot.verification.map((check) => (
              <div className={`orcs-check orcs-check--${check.status}`} key={check.id}>
                <span className="orcs-check__dot" aria-hidden="true" />
                <strong>{check.label}</strong>
                <span>{CHECK_LABELS[locale][check.status]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="orcs-control__section">
          <h3>{copy.timeline}</h3>
          <div className="orcs-timeline">
            {snapshot.timeline.slice(-5).map((event) => (
              <div className={`orcs-event orcs-event--${event.level}`} key={event.id}>
                <time>{timeFormatter.format(new Date(event.occurredAt))}</time>
                <span className="orcs-event__level">{eventLevelMark(event.level)}</span>
                <p>{event.message}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function eventLevelMark(level: OrcsEventLevel): string {
  if (level === "success") return "✓";
  if (level === "warning") return "!";
  if (level === "error") return "×";
  return "·";
}
