import { useMemo, useState } from "react";
import type { LocaleId } from "../../../../shared/contracts";
import type {
  OrcsCheckStatus,
  OrcsEventLevel,
  OrcsRoleId,
  OrcsRoleStatus
} from "../../../../shared/orcs";
import { createMockOrcsSnapshot } from "./orcsMock";

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
    subtitle: "Безопасный mock-режим",
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
    readOnly: "Только чтение · реальный ORCS не запущен"
  },
  en: {
    title: "ORCS Control Room",
    subtitle: "Safe mock mode",
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
    readOnly: "Read-only · real ORCS is not running"
  }
} as const;

export function OrcsControlRoom(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const snapshot = useMemo(() => createMockOrcsSnapshot(), []);
  const locale: LocaleId = navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
  const copy = COPY[locale];
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(
    locale === "ru" ? "ru-RU" : "en-US",
    { hour: "2-digit", minute: "2-digit", second: "2-digit" }
  ), [locale]);

  return (
    <div className={`orcs-control ${open ? "orcs-control--open" : ""}`} data-interactive="true">
      <button
        className="orcs-control__toggle"
        type="button"
        aria-expanded={open}
        aria-controls="orcs-control-room"
        aria-label={open ? copy.close : copy.open}
        title={open ? copy.close : copy.open}
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
            <span className="orcs-control__eyebrow">{copy.subtitle}</span>
            <h2>{copy.title}</h2>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label={copy.close}>×</button>
        </header>

        <section className="orcs-control__summary">
          <div className="orcs-control__task">
            <span>{copy.currentTask}</span>
            <strong>{snapshot.taskTitle}</strong>
            <small>{copy.source}: {snapshot.source} · {snapshot.headSha?.slice(0, 8)}</small>
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

        <footer className="orcs-control__footer">{copy.readOnly}</footer>
      </aside>
    </div>
  );
}

function eventLevelMark(level: OrcsEventLevel): string {
  if (level === "success") return "✓";
  if (level === "warning") return "!";
  if (level === "error") return "×";
  return "·";
}
