// lib/tour.ts — product tour engine (driver.js). Open-core: available in both builds.
// Each page gets its own short, independent tour keyed by a "page" id. A tour is shown
// once automatically (tracked server-side via /api/tour) and can be replayed manually
// from Settings → General ("Restart tour"), which never touches the "seen" state.
"use client";

import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

export type TourPage =
  | "dashboard"
  | "lists"
  | "contacts"
  | "companies"
  | "workflows"
  | "inbox"
  | "settings";

// Steps whose `element` selector isn't in the DOM are silently skipped by driver.js —
// relied on here so a step referencing a premium-only anchor (Todos nav, InMail, MCP)
// just no-ops cleanly in the open-core build instead of needing its own guard.
const TOURS: Record<TourPage, DriveStep[]> = {
  dashboard: [
    {
      element: '[data-tour="nav-dashboard"]',
      popover: {
        title: "Welcome to Linki",
        description: "This is your outreach dashboard. Everything in Linki runs on one background process at a human pace — nothing fires the instant you click a button, so don't expect instant numbers here either.",
      },
    },
    {
      element: '[data-tour="dashboard-filters"]',
      popover: {
        title: "LinkedIn and email, side by side",
        description: "The two channels are tracked completely separately — a campaign can run both at once, and this page reports them independently rather than blended.",
      },
    },
    {
      element: '[data-tour="dashboard-funnel"]',
      popover: {
        title: "Your outreach funnel",
        description: "See exactly where leads drop off — from total targets down to replies. This is the \"is my campaign actually working\" view.",
      },
    },
    {
      element: '[data-tour="dashboard-chart"]',
      popover: {
        title: "Activity over time",
        description: "Visits, connections, messages and emails per day. Click a series label to toggle it off, or change the day range to reshape the whole page.",
      },
    },
    {
      element: '[data-tour="nav-settings"]',
      popover: {
        title: "First: connect a LinkedIn account",
        description: "Nothing else works until an account is authenticated in Settings → LinkedIn — that's the one true prerequisite before importing or running anything.",
      },
    },
    {
      element: '[data-tour="nav-lists"]',
      popover: {
        title: "Then: import a list",
        description: "Paste a Sales Navigator search URL — that's how leads get into Linki.",
      },
    },
    {
      element: '[data-tour="nav-workflows"]',
      popover: {
        title: "Then: build a campaign",
        description: "Chain steps like visit, connect, message and email into a sequence, pick the list and account, and launch.",
      },
    },
  ],

  lists: [
    {
      element: '[data-tour="lists-new"]',
      popover: {
        title: "Create a list",
        description: "Paste a LinkedIn Sales Navigator search URL to scrape leads automatically.",
      },
    },
    {
      element: '[data-tour="lists-new"]',
      popover: {
        title: "Imports run in the background",
        description: "A Sales Navigator import doesn't happen instantly — it's queued and scraped in small batches with human-like delays, specifically to avoid LinkedIn flagging the account.",
      },
    },
    {
      element: '[data-tour="lists-jobs"]',
      popover: {
        title: "Import jobs",
        description: "There's a shared daily import cap across every list (configurable in Settings → General) — a large list automatically spills into the next day. Track progress and cancel batches here.",
      },
    },
    {
      element: '[data-tour="lists-new"]',
      popover: {
        title: "A fresh import is intentionally thin",
        description: "Newly imported leads only have basic data (name, title, company). Full profile and email enrichment happen later, automatically, right before a campaign actually needs them — you don't need to enrich everything up front.",
      },
    },
  ],

  contacts: [
    {
      element: '[data-tour="nav-contacts"]',
      popover: {
        title: "Every lead, in one place",
        description: "This is the single, deduplicated view of everyone you've ever imported — the same person can belong to several lists, and shows up here just once regardless.",
      },
    },
    {
      element: '[data-tour="contacts-filters"]',
      popover: {
        title: "Search and filter",
        description: "Filter by list, title, connection status, seniority, or email verification to build a targeted sub-audience without re-importing anything.",
      },
    },
    {
      element: '[data-tour="contacts-select"]',
      popover: {
        title: "Bulk-select, then add to a list",
        description: "Select multiple contacts and add them all to a list at once — an easy way to turn a filtered view (e.g. everyone who replied) into a new targeted list. Contacts already in that list are skipped.",
      },
    },
  ],

  companies: [
    {
      element: '[data-tour="nav-companies"]',
      popover: {
        title: "Companies",
        description: "Enriched organization records — industry, size, tech stack, revenue — that populate automatically as contacts get enriched. You can also add or edit one by hand.",
      },
    },
  ],

  workflows: [
    {
      element: '[data-tour="workflows-new"]',
      popover: {
        title: "Build a campaign",
        description: "A campaign chains steps — visit, connect, message, email — into a repeatable sequence, then runs it against a list of contacts through one LinkedIn account.",
      },
    },
    {
      element: '[data-tour="workflows-new"]',
      popover: {
        title: "LinkedIn and email run in parallel",
        description: "LinkedIn steps and email steps are two independent tracks for the same contact. A reply on either channel stops that person's outreach on both — you don't need to manage them separately.",
      },
    },
    {
      element: '[data-tour="workflows-new"]',
      popover: {
        title: "A LinkedIn account is always required",
        description: "Even an email-only campaign needs one authenticated LinkedIn account selected — set that up first in Settings if you haven't.",
      },
    },
    {
      element: '[data-tour="workflows-new"]',
      popover: {
        title: "One active run at a time",
        description: "A campaign can only have one run going at once. To reach more people later, use \"Add contacts\" on the running campaign instead of starting a second run.",
      },
    },
    {
      element: '[data-tour="workflows-new"]',
      popover: {
        title: "It runs at a human pace",
        description: "Launching doesn't message everyone instantly — the runner works through the list gradually in the background, respecting daily limits and working hours per account.",
      },
    },
  ],

  inbox: [
    {
      element: '[data-tour="nav-inbox"]',
      popover: {
        title: "Every reply, one place",
        description: "Replies from LinkedIn and email land here automatically — no need to check either inbox by hand. A reply also automatically stops that contact's outreach.",
      },
    },
    {
      element: '[data-tour="nav-inbox"]',
      popover: {
        title: "Not every reply means interest",
        description: "Reply counts can be misleadingly high — many are auto-responders (out-of-office, \"contact my colleague\") rather than genuine interest. Open one to see the full thread and judge for yourself.",
      },
    },
  ],

  settings: [
    {
      element: '[data-tour="settings-tab-linkedin"]',
      popover: {
        title: "Connect a LinkedIn account first",
        description: "An account must be authenticated here before it can be used in any campaign — this is the single most important setup step in Linki.",
      },
    },
    {
      element: '[data-tour="settings-tab-email"]',
      popover: {
        title: "Email accounts, with ramp-up",
        description: "Configure SMTP/IMAP for email steps. A new account can ramp up sending volume gradually instead of blasting at full volume from day one, which helps it avoid getting flagged as spam.",
      },
    },
    {
      element: '[data-tour="settings-tab-integrations"]',
      popover: {
        title: "Apollo enrichment",
        description: "Add an Apollo API key here to enrich leads with verified emails, seniority, and company data.",
      },
    },
    {
      element: '[data-tour="settings-tab-general"]',
      popover: {
        title: "Connect an AI agent",
        description: "The General tab has a copyable MCP URL to hook up Claude Code, Cursor, or any MCP-compatible agent to manage Linki on your behalf — plus the daily import cap and this tour picker.",
      },
    },
  ],
};

function markSeen(page: TourPage) {
  fetch("/api/tour", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page }),
  }).catch(() => {});
}

function buildAndRun(page: TourPage, persist: boolean) {
  const steps = TOURS[page];
  if (!steps || steps.length === 0) return;

  const d = driver({
    showProgress: true,
    overlayColor: "#000",
    overlayOpacity: 0.65,
    stagePadding: 6,
    stageRadius: 8,
    popoverOffset: 12,
    allowClose: true,
    popoverClass: "linki-tour-popover",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    steps,
    onDestroyed: () => {
      if (persist) markSeen(page);
    },
  });

  d.drive();
}

export function startPageTour(page: TourPage) {
  buildAndRun(page, true);
}

export function replayPageTour(page: TourPage) {
  buildAndRun(page, false);
}

export async function getSeenTours(): Promise<Set<TourPage>> {
  try {
    const res = await fetch("/api/tour");
    if (!res.ok) return new Set();
    const data = await res.json();
    return new Set((data.seen ?? []) as TourPage[]);
  } catch {
    return new Set();
  }
}

export const ALL_TOUR_PAGES: TourPage[] = ["dashboard", "lists", "contacts", "companies", "workflows", "inbox", "settings"];

export const TOUR_PAGE_LABELS: Record<TourPage, string> = {
  dashboard: "Dashboard",
  lists: "Lists",
  contacts: "Contacts",
  companies: "Companies",
  workflows: "Campaigns",
  inbox: "Inbox",
  settings: "Settings",
};

// Maps a pathname to its tour page id, or null if the current page has no tour
// (e.g. a detail route like /lists/[id] — the index page's tour covers the entry point).
export function pathToTourPage(pathname: string): TourPage | null {
  if (pathname === "/") return "dashboard";
  if (pathname === "/lists") return "lists";
  if (pathname === "/contacts") return "contacts";
  if (pathname === "/companies") return "companies";
  if (pathname === "/workflows") return "workflows";
  if (pathname === "/inbox") return "inbox";
  if (pathname === "/settings") return "settings";
  return null;
}
