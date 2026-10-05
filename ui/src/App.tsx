import { useQueryClient } from "@tanstack/react-query";
import { Component, type ReactNode, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { useEngineEvents, useSettings } from "./api.ts";
import logo from "./assets/exva-icon.png";
import { Assistant } from "./components/Assistant.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { cx, Icon } from "./components/ui.tsx";
import { BotDetail } from "./pages/BotDetail.tsx";
import { Bots } from "./pages/Bots.tsx";
import { BotWizard } from "./pages/BotWizard.tsx";
import { Home } from "./pages/Home.tsx";
import { Lab } from "./pages/Lab.tsx";
import { Onboarding } from "./pages/Onboarding.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { Trades } from "./pages/Trades.tsx";

const NAV = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/bots", label: "Bots", icon: "bot" },
  { href: "/trades", label: "Trades", icon: "list" },
  { href: "/lab", label: "Lab", icon: "flask" },
] as const;

function NavLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: "home" | "bot" | "list" | "flask" | "gear";
}) {
  const [location] = useLocation();
  const active = href === "/" ? location === "/" : location.startsWith(href);
  return (
    <Link
      href={href}
      className={cx(
        "flex flex-col items-center gap-1 rounded py-2 text-[11px] transition-colors",
        active ? "bg-surface3 text-ink" : "text-ink2 hover:text-ink",
      )}
    >
      <Icon name={icon} className="h-5 w-5" />
      {label}
    </Link>
  );
}

export function App() {
  const client = useQueryClient();
  useEngineEvents(client);
  const { data: settings, isLoading } = useSettings();
  const [assistant, setAssistant] = useState(false);
  const [location] = useLocation();

  if (isLoading) return null;
  if (settings && !settings.onboarded) return <Onboarding />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[72px] shrink-0 flex-col gap-1 border-r border-line bg-surface p-2">
          <Link href="/" className="mb-3 flex justify-center py-2">
            <img src={logo} alt="Exva" className="h-8 w-8" draggable={false} />
          </Link>
          {NAV.map((n) => (
            <NavLink key={n.href} {...n} />
          ))}
          <div className="mt-auto flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setAssistant((v) => !v)}
              className={cx(
                "flex flex-col items-center gap-1 rounded py-2 text-[11px] transition-colors",
                assistant ? "bg-ai/15 text-ai" : "text-ink2 hover:text-ai",
              )}
            >
              <Icon name="spark" className="h-5 w-5" />
              Ask
            </button>
            <NavLink href="/settings" label="Settings" icon="gear" />
          </div>
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl p-6">
            <PageBoundary key={location}>
              <Switch>
                <Route path="/" component={Home} />
                <Route path="/bots" component={Bots} />
                <Route path="/bots/new">{() => <BotWizard />}</Route>
                <Route path="/bots/:id/edit">{(p) => <BotWizard editId={p.id} />}</Route>
                <Route path="/bots/:id">{(p) => <BotDetail id={p.id} />}</Route>
                <Route path="/trades" component={Trades} />
                <Route path="/lab" component={Lab} />
                <Route path="/settings" component={SettingsPage} />
                <Route>
                  <div className="text-ink3">Page not found.</div>
                </Route>
              </Switch>
            </PageBoundary>
          </div>
        </main>
      </div>
      <StatusBar />
      <Assistant open={assistant} onClose={() => setAssistant(false)} />
    </div>
  );
}

export function PageTitle({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-medium">{title}</h1>
        {sub && <div className="mt-0.5 text-sm text-ink3">{sub}</div>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

/** One broken panel shows an error instead of blanking the app. Resets on navigation. */
class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded border border-down/30 bg-down/10 p-4 text-sm text-down">
        Something on this page broke: {this.state.error.message}. Other pages still work.
      </div>
    );
  }
}
