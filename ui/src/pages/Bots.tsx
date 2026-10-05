import { Link } from "wouter";
import { PageTitle } from "../App.tsx";
import { useBots } from "../api.ts";
import { BotCard } from "../components/bits.tsx";
import { Button, Empty, Icon } from "../components/ui.tsx";

export function Bots() {
  const { data: bots = [], isLoading } = useBots();
  const running = bots.filter((b) => b.status === "running");
  const stopped = bots.filter((b) => b.status !== "running");
  return (
    <div>
      <PageTitle
        title="Bots"
        sub="A bot runs one strategy on a few symbols and records a decision every time a bar closes."
        actions={
          <Link href="/bots/new">
            <Button variant="primary">
              <Icon name="plus" /> New bot
            </Button>
          </Link>
        }
      />
      {!isLoading && bots.length === 0 && <Empty>No bots yet.</Empty>}
      {running.length > 0 && (
        <section className="mb-6 space-y-2">
          <h2 className="font-mono text-label uppercase text-ink3">Running</h2>
          {running.map((b) => (
            <BotCard key={b.id} bot={b} />
          ))}
        </section>
      )}
      {stopped.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-mono text-label uppercase text-ink3">Stopped</h2>
          {stopped.map((b) => (
            <BotCard key={b.id} bot={b} />
          ))}
        </section>
      )}
    </div>
  );
}
