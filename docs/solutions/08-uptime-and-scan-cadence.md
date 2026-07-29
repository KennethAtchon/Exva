# Solution 08 - Uptime, Autostart, and Scan Cadence

> **Outcome:** Exva is running before the market opens, evaluates on its first eligible tick rather
> than one interval later, and reports what fraction of the trading day it was actually able to trade.
> **Cost of not doing this:** On July 27 the app booted at 15:42Z — 2 hours 12 minutes after the equity
> open — and every session was stopped by 04:05Z. Roughly a third of the day's opportunity was
> unreachable regardless of how correct the code was.

Implements: docs/engineering/CODING_GUIDELINES.md

## Verified Current Behavior

**Autostart already exists and is not being used.** The repository ships:

| File                           | Purpose                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `scripts/install-launchd.sh`   | Installs `com.exva.headless` LaunchAgent, `RunAtLoad`, `KeepAlive` |
| `scripts/uninstall-launchd.sh` | Removes it                                                         |
| `scripts/run-headless.sh`      | Boots the main process with `EXVA_HEADLESS=1`, no BrowserWindow    |
| `package.json` -> `headless`   | `bash scripts/run-headless.sh`                                     |

`run-headless.sh` already handles the GUI/headless collision correctly: it exits early if
`~/.exva/suppress-headless` exists or if `~/.exva/instance.lock` reports `"mode": "gui"`.

None of this appears in any setup document, runbook, or solution doc. The July 27 late boot was
therefore a **user action that was never communicated**, not a missing feature. It belongs in the
Solution 04 user-action matrix.

**First scan is delayed by a full interval.** `alpha-source-scan-service.ts`:

```ts
start(): void {
  if (this.running) return;
  this.running = true;
  this.arm();                       // setTimeout(intervalMs) — no immediate tick
  logger.info({ intervalMs: this.intervalMs }, "alpha source scans armed");
}

private arm(): void {
  if (this.timer) clearTimeout(this.timer);
  this.timer = setTimeout(() => { ... }, this.intervalMs);
}
```

With `DEFAULT_INTERVAL_MS = 30 * 60_000`, starting the app produces no alpha source scan for 30
minutes. `tickNow()` exists but is documented "for tests / Dev Panel" and is not called at start. A late
boot therefore costs the boot delay **plus** one full interval.

## Workstream 1: Install Autostart

This is a user action with an exact command. It is the single cheapest recovery of lost opportunity in
the entire program.

```bash
bash scripts/install-launchd.sh
launchctl print "gui/$(id -u)/com.exva.headless" | head -20   # verify loaded
tail -f ~/.exva/logs/headless.stdout.log                       # verify booting
```

Rules and caveats to document alongside it:

- The agent runs at **login**, not at boot. A machine that is asleep or logged out at 09:30 ET is not
  running Exva. If the machine sleeps overnight, wake scheduling is a separate OS-level decision.
- `KeepAlive.SuccessfulExit: false` restarts the process only on non-zero exit. A clean shutdown stays
  down.
- Launching the GUI while headless runs is handled by the instance lock, but the two must never both
  own sessions. Verify `~/.exva/instance.lock` after switching modes.
- Headless mode must have the same credentials available; environment variables in the plist are
  limited to `EXVA_HEADLESS` and `PATH`. Broker keys stored in Settings are read from the app database,
  not the environment, so no plist secrets are required — verify this before relying on it.

## Workstream 2: Immediate First Tick

Every periodic runtime must evaluate once on start, subject to its own eligibility guard, before arming
the interval.

Applies to `AlphaSourceScanService` and to any scheduler lane with the same arm-then-wait shape.

```ts
start(): void {
  if (this.running) return;
  this.running = true;
  void this.tick().finally(() => { if (this.running) this.arm(); });
  logger.info({ intervalMs: this.intervalMs }, "alpha source scans armed");
}
```

Guards that must remain:

- `tickInFlight` re-entrancy protection is unchanged.
- The immediate tick still respects market-hours and source-eligibility gates; it does not force work
  that the interval tick would skip.
- Restart loops must not turn the immediate tick into a hot loop; a minimum inter-tick spacing applies
  regardless of restart count.

## Workstream 3: Market-Open Alignment

Scheduled scan cadence should be anchored to the session calendar, not to process start time.

| Requirement          | Behavior                                                                       |
| -------------------- | ------------------------------------------------------------------------------ |
| Open alignment       | The first eligible scan of a trading day runs within one minute of the open    |
| Bar-close alignment  | Timeframe lanes tick shortly after the expected bar close, plus provider delay |
| Late-boot catch-up   | Booting mid-session runs one immediate eligible scan, then aligns to the grid  |
| Closed-market idling | No scan work while closed; the next eligible time is displayed, not retried    |

This interlocks with Solution 02's freshness contract: the expected closed-bar timestamp is the same
calculation used for both alignment and staleness. Implement it once.

## Workstream 4: Measure Uptime Against Opportunity

"Was the system running?" must be answerable per day per session, because it changes how every other
metric is read.

Persist per session per trading day:

```text
eligibleWindowMinutes     — minutes the session's market was open and the session was startable
liveMinutes               — minutes the session was actually running
coveragePct               — liveMinutes / eligibleWindowMinutes
firstEligibleScanAt       — first scan after the open
minutesLateAtOpen         — firstEligibleScanAt - open
unplannedStops            — process exits or crashes during the eligible window
```

The one-day acceptance report in Solution 05 must include these fields. A day with 62% coverage cannot
be used to conclude anything about setup rates.

## Workstream 5: Session Staleness Detection

`session-activity-tracker.ts` `sweepNoSignalStale()` measures age since **session creation** and checks
whether the session has **ever** recorded an execution step or delivery:

```ts
if (stepCount === 0 && deliveryCount === 0) {
  /* warn */
}
```

Consequence: a session that consumed one input at boot and then nothing for twelve hours never flags.
The condition detects a session that was born dead, not one that went quiet — which is the more common
and more dangerous case.

Change to a rolling-window evaluation:

- Compare the most recent execution step / delivery timestamp against **now**.
- The threshold is derived from the session's expected cadence (two expected bars or two expected poll
  intervals), not a fixed 12 hours.
- Fire `no_signal_stale` when the gap exceeds the threshold during an eligible window only; a quiet
  weekend is not a defect.
- Keep the existing born-dead check as a separate, distinctly-coded condition.

Note for the record: the July 27 sessions stopping at 04:05Z was not this condition — it is a warning,
not an auto-stop. Attribute the stop to process shutdown, which Workstream 4 will make visible.

## Tests

### Unit

- `start()` performs exactly one immediate tick and then arms the interval.
- The immediate tick respects market-hours and eligibility guards.
- Rapid restart cannot produce ticks closer than the minimum spacing.
- Open alignment produces a first scan within one minute of the open for NYSE and immediately for
  always-open crypto.
- Rolling staleness fires on a gap during an eligible window and stays silent over a weekend.
- Born-dead and went-quiet conditions have distinct codes.

### Composition

Boot the runtime with a faked clock two hours after the open. Assert: one immediate eligible scan, grid
alignment thereafter, and `minutesLateAtOpen` recorded truthfully.

### Operational

After installing the LaunchAgent, a machine login produces a headless boot with sessions active, and
`coveragePct` for the next full trading day is at least 99%.

## Acceptance Criteria

- [ ] The LaunchAgent is installed and documented in the setup runbook.
- [ ] GUI and headless never both own sessions; the lock behavior is verified, not assumed.
- [ ] No periodic runtime waits a full interval before its first tick.
- [ ] The first eligible scan of a trading day occurs within one minute of the open.
- [ ] Booting mid-session runs an immediate catch-up scan.
- [ ] `coveragePct`, `minutesLateAtOpen`, and `unplannedStops` are persisted per session per day.
- [ ] Staleness detection uses a rolling window tied to expected cadence.
- [ ] The one-day acceptance report refuses to draw setup-rate conclusions below 90% coverage.
