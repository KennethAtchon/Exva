/**
 * Seeded FOMC / CPI dates for 2026–2027.
 * Extend via CalendarEventsRepo / Settings editor; this file is the ship seed.
 */

export interface MacroCalendarSeedRow {
  eventType: "fomc" | "cpi";
  scheduledAt: string;
  title: string;
}

export const MACRO_CALENDAR_SEED_2026_2027: MacroCalendarSeedRow[] = [
  // FOMC 2026 (scheduled meeting ends — decision day)
  {
    eventType: "fomc",
    scheduledAt: "2026-01-28T19:00:00.000Z",
    title: "FOMC decision Jan 2026",
  },
  {
    eventType: "fomc",
    scheduledAt: "2026-03-18T18:00:00.000Z",
    title: "FOMC decision Mar 2026",
  },
  {
    eventType: "fomc",
    scheduledAt: "2026-04-29T18:00:00.000Z",
    title: "FOMC decision Apr 2026",
  },
  {
    eventType: "fomc",
    scheduledAt: "2026-06-17T18:00:00.000Z",
    title: "FOMC decision Jun 2026",
  },
  {
    eventType: "fomc",
    scheduledAt: "2026-07-29T18:00:00.000Z",
    title: "FOMC decision Jul 2026",
  },
  {
    eventType: "fomc",
    scheduledAt: "2026-09-16T18:00:00.000Z",
    title: "FOMC decision Sep 2026",
  },
  {
    eventType: "fomc",
    scheduledAt: "2026-11-04T18:00:00.000Z",
    title: "FOMC decision Nov 2026",
  },
  {
    eventType: "fomc",
    scheduledAt: "2026-12-16T19:00:00.000Z",
    title: "FOMC decision Dec 2026",
  },
  // FOMC 2027
  {
    eventType: "fomc",
    scheduledAt: "2027-01-27T19:00:00.000Z",
    title: "FOMC decision Jan 2027",
  },
  {
    eventType: "fomc",
    scheduledAt: "2027-03-17T18:00:00.000Z",
    title: "FOMC decision Mar 2027",
  },
  {
    eventType: "fomc",
    scheduledAt: "2027-05-05T18:00:00.000Z",
    title: "FOMC decision May 2027",
  },
  {
    eventType: "fomc",
    scheduledAt: "2027-06-16T18:00:00.000Z",
    title: "FOMC decision Jun 2027",
  },
  {
    eventType: "fomc",
    scheduledAt: "2027-07-28T18:00:00.000Z",
    title: "FOMC decision Jul 2027",
  },
  {
    eventType: "fomc",
    scheduledAt: "2027-09-15T18:00:00.000Z",
    title: "FOMC decision Sep 2027",
  },
  {
    eventType: "fomc",
    scheduledAt: "2027-11-03T18:00:00.000Z",
    title: "FOMC decision Nov 2027",
  },
  {
    eventType: "fomc",
    scheduledAt: "2027-12-15T19:00:00.000Z",
    title: "FOMC decision Dec 2027",
  },
  // CPI release approx (BLS mid-month ~8:30 ET)
  {
    eventType: "cpi",
    scheduledAt: "2026-01-14T13:30:00.000Z",
    title: "CPI Jan 2026",
  },
  {
    eventType: "cpi",
    scheduledAt: "2026-02-11T13:30:00.000Z",
    title: "CPI Feb 2026",
  },
  {
    eventType: "cpi",
    scheduledAt: "2026-03-11T13:30:00.000Z",
    title: "CPI Mar 2026",
  },
  {
    eventType: "cpi",
    scheduledAt: "2026-04-14T12:30:00.000Z",
    title: "CPI Apr 2026",
  },
  {
    eventType: "cpi",
    scheduledAt: "2026-05-13T12:30:00.000Z",
    title: "CPI May 2026",
  },
  {
    eventType: "cpi",
    scheduledAt: "2026-06-10T12:30:00.000Z",
    title: "CPI Jun 2026",
  },
  {
    eventType: "cpi",
    scheduledAt: "2026-07-14T12:30:00.000Z",
    title: "CPI Jul 2026",
  },
  {
    eventType: "cpi",
    scheduledAt: "2026-08-12T12:30:00.000Z",
    title: "CPI Aug 2026",
  },
  {
    eventType: "cpi",
    scheduledAt: "2026-09-11T12:30:00.000Z",
    title: "CPI Sep 2026",
  },
  {
    eventType: "cpi",
    scheduledAt: "2026-10-14T12:30:00.000Z",
    title: "CPI Oct 2026",
  },
  {
    eventType: "cpi",
    scheduledAt: "2026-11-12T13:30:00.000Z",
    title: "CPI Nov 2026",
  },
  {
    eventType: "cpi",
    scheduledAt: "2026-12-10T13:30:00.000Z",
    title: "CPI Dec 2026",
  },
  {
    eventType: "cpi",
    scheduledAt: "2027-01-13T13:30:00.000Z",
    title: "CPI Jan 2027",
  },
  {
    eventType: "cpi",
    scheduledAt: "2027-02-10T13:30:00.000Z",
    title: "CPI Feb 2027",
  },
  {
    eventType: "cpi",
    scheduledAt: "2027-03-10T13:30:00.000Z",
    title: "CPI Mar 2027",
  },
  {
    eventType: "cpi",
    scheduledAt: "2027-04-13T12:30:00.000Z",
    title: "CPI Apr 2027",
  },
  {
    eventType: "cpi",
    scheduledAt: "2027-05-12T12:30:00.000Z",
    title: "CPI May 2027",
  },
  {
    eventType: "cpi",
    scheduledAt: "2027-06-10T12:30:00.000Z",
    title: "CPI Jun 2027",
  },
  {
    eventType: "cpi",
    scheduledAt: "2027-07-14T12:30:00.000Z",
    title: "CPI Jul 2027",
  },
  {
    eventType: "cpi",
    scheduledAt: "2027-08-11T12:30:00.000Z",
    title: "CPI Aug 2027",
  },
  {
    eventType: "cpi",
    scheduledAt: "2027-09-14T12:30:00.000Z",
    title: "CPI Sep 2027",
  },
  {
    eventType: "cpi",
    scheduledAt: "2027-10-13T12:30:00.000Z",
    title: "CPI Oct 2027",
  },
  {
    eventType: "cpi",
    scheduledAt: "2027-11-10T13:30:00.000Z",
    title: "CPI Nov 2027",
  },
  {
    eventType: "cpi",
    scheduledAt: "2027-12-10T13:30:00.000Z",
    title: "CPI Dec 2027",
  },
];
