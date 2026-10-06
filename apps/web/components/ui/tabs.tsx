"use client";

import type { KeyboardEvent, ReactNode } from "react";

export type TabDef<K extends string> = { key: K; label: ReactNode; icon?: ReactNode };

const tabId = (prefix: string, key: string) => `${prefix}-tab-${key}`;
const panelId = (prefix: string, key: string) => `${prefix}-panel-${key}`;

/**
 * A tab strip with the keyboard behaviour screen-reader users expect: one tab stop (the selected tab), Left/Right
 * (and Home/End) move between tabs, each tab names the panel it controls. The look is the caller's: pass the
 * classes for the strip and for a tab in each state.
 */
export function TabList<K extends string>({
  tabs, value, onChange, label, idPrefix, className, tabClassName,
}: {
  tabs: TabDef<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  idPrefix: string;
  className?: string;
  tabClassName: (selected: boolean) => string;
}) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex((t) => t.key === value);
    const next =
      e.key === "ArrowRight" ? (i + 1) % tabs.length
      : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].key);
    // Move DOM focus with the selection (the selected tab is the only one in the tab order).
    document.getElementById(tabId(idPrefix, tabs[next].key))?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className={className} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.key}
          id={tabId(idPrefix, t.key)}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          aria-controls={panelId(idPrefix, t.key)}
          tabIndex={value === t.key ? 0 : -1}
          onClick={() => onChange(t.key)}
          className={tabClassName(value === t.key)}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** The panel a tab controls. Without a `tabKey` (the strip is not shown) it is a plain wrapper, so no role points at a missing tab. */
export function TabPanel({ idPrefix, tabKey, children, className }: { idPrefix: string; tabKey?: string; children: ReactNode; className?: string }) {
  if (!tabKey) return <div className={className}>{children}</div>;
  return (
    <div role="tabpanel" id={panelId(idPrefix, tabKey)} aria-labelledby={tabId(idPrefix, tabKey)} className={className}>
      {children}
    </div>
  );
}
