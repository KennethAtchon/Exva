import type { AiProvider, Settings } from "@shared/types.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PageTitle } from "../App.tsx";
import { api, useAccounts, useSettings, useStatus } from "../api.ts";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Notice,
  NumberInput,
  Select,
  Switch,
} from "../components/ui.tsx";
import { usd } from "../format.ts";

export const AI_PROVIDERS: { value: AiProvider; label: string; baseUrl: string; model: string }[] =
  [
    {
      value: "openrouter",
      label: "OpenRouter (DeepSeek V4.1 Flash)",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "deepseek/deepseek-v4.1-flash",
    },
    { value: "custom", label: "Other OpenAI-compatible", baseUrl: "", model: "" },
  ];

export function SettingsPage() {
  const { data: settings } = useSettings();
  if (!settings) return null;
  return (
    <div className="space-y-5">
      <PageTitle title="Settings" />
      <Accounts />
      <AiSettings settings={settings} />
      <General settings={settings} />
    </div>
  );
}

export function AddAlpaca({ onDone }: { onDone?: (accountId: string) => void }) {
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const client = useQueryClient();
  const save = async () => {
    setError(null);
    try {
      const a = await api.saveAccount({
        name: "Alpaca Paper",
        broker: "alpaca",
        keyId: keyId.trim(),
        secretKey: secret.trim(),
      });
      const r = await api.testAccount(a.id);
      setResult(r);
      client.invalidateQueries();
      if (r.ok) onDone?.(a.id);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="API key ID" hint="From app.alpaca.markets → Paper Trading → API Keys">
          <Input
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
            placeholder="PK…"
            autoComplete="off"
          />
        </Field>
        <Field label="Secret key">
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
          />
        </Field>
      </div>
      <Button variant="primary" onClick={save} disabled={!keyId || !secret}>
        Save and test
      </Button>
      {result && (
        <div className={result.ok ? "text-sm text-up" : "text-sm text-down"}>{result.message}</div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

function Accounts() {
  const { data: accounts = [] } = useAccounts();
  const { data: status } = useStatus();
  const client = useQueryClient();
  const [adding, setAdding] = useState<"alpaca" | "sim" | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [cash, setCash] = useState<number | null>(100_000);
  return (
    <Card title="Accounts" actions={<span className="text-xs text-ink3">Paper trading only</span>}>
      <ul className="mb-4 divide-y divide-hair">
        {accounts.map((a) => {
          const health = status?.accounts.find((x) => x.id === a.id);
          return (
            <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="font-medium">{a.name}</span>
              <span className="text-ink3">
                {a.broker === "sim"
                  ? `Simulator, started with ${usd(a.startingCash)}`
                  : a.hasKeys
                    ? "Alpaca paper"
                    : "Alpaca paper (no keys)"}
              </span>
              <span className="ml-auto font-mono text-xs text-ink2">
                {tests[a.id] ?? (health?.equity ? usd(health.equity) : "")}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const r = await api.testAccount(a.id);
                  setTests((t) => ({ ...t, [a.id]: r.message }));
                }}
              >
                Test
              </Button>
            </li>
          );
        })}
        {accounts.length === 0 && <li className="py-2 text-sm text-ink3">No accounts yet.</li>}
      </ul>
      {adding === null && (
        <div className="flex gap-2">
          <Button onClick={() => setAdding("alpaca")}>Add Alpaca paper account</Button>
          <Button variant="ghost" onClick={() => setAdding("sim")}>
            Add simulator account
          </Button>
        </div>
      )}
      {adding === "alpaca" && <AddAlpaca onDone={() => setAdding(null)} />}
      {adding === "sim" && (
        <div className="flex items-end gap-3">
          <Field label="Starting cash">
            <NumberInput value={cash} onChange={setCash} min={100} />
          </Field>
          <Button
            variant="primary"
            onClick={async () => {
              await api.saveAccount({
                name: "Simulator",
                broker: "sim",
                startingCash: cash ?? 100_000,
              });
              setAdding(null);
              client.invalidateQueries();
            }}
          >
            Add
          </Button>
        </div>
      )}
    </Card>
  );
}

function useSaver() {
  const client = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async (patch: Record<string, unknown>) => {
    setError(null);
    try {
      await api.saveSettings(patch);
      client.invalidateQueries({ queryKey: ["settings"] });
      client.invalidateQueries({ queryKey: ["status"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err);
    }
  };
  return { save, saved, error };
}

function AiSettings({ settings }: { settings: Settings }) {
  const [ai, setAi] = useState(settings.ai);
  const [key, setKey] = useState("");
  const { save, saved, error } = useSaver();
  useEffect(() => setAi(settings.ai), [settings.ai]);
  const set = (patch: Partial<Settings["ai"]>) => setAi((a) => ({ ...a, ...patch }));
  const provider = (p: AiProvider) => {
    const preset = AI_PROVIDERS.find((x) => x.value === p);
    set({
      provider: p,
      ...(preset?.baseUrl ? { baseUrl: preset.baseUrl, model: preset.model } : {}),
    });
  };
  const { hasKey: _, ...editable } = ai;
  return (
    <Card
      title="AI"
      actions={
        settings.ai.hasKey ? (
          <span className="text-xs text-up">Key saved ✓</span>
        ) : (
          <span className="text-xs text-ink3">No key: AI features are off</span>
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider">
          <Select
            value={ai.provider}
            onChange={provider}
            options={AI_PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
          />
        </Field>
        <Field
          label="API key"
          hint={
            settings.ai.hasKey
              ? "Leave empty to keep the saved key."
              : "Stored on this computer only, outside the database."
          }
        >
          <Input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={settings.ai.hasKey ? "••••••••" : "sk-or-…"}
            autoComplete="off"
          />
        </Field>
        <Field label="Model">
          <Input
            value={ai.model}
            onChange={(e) => set({ model: e.target.value })}
            className="font-mono"
          />
        </Field>
        <Field label="Base URL">
          <Input
            value={ai.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value })}
            className="font-mono"
          />
        </Field>
        <Field
          label="Daily budget $"
          hint="AI calls stop for the day once this is spent. Backtests have their own per-run cap."
        >
          <NumberInput
            value={ai.dailyBudgetUsd}
            min={0}
            step={0.5}
            onChange={(v) => set({ dailyBudgetUsd: v ?? 0 })}
          />
        </Field>
        <Field label="Morning journal" hint="Local time to write the daily summary.">
          <Select
            value={String(ai.journalHour)}
            onChange={(v) => set({ journalHour: Number(v) })}
            options={[
              { value: "-1", label: "Off" },
              ...Array.from({ length: 24 }, (_, h) => ({
                value: String(h),
                label: `${String(h).padStart(2, "0")}:00`,
              })),
            ]}
          />
        </Field>
        <Field label="Input $ / million tokens">
          <NumberInput
            value={ai.inputPricePerM}
            step="any"
            onChange={(v) => set({ inputPricePerM: v ?? 0 })}
          />
        </Field>
        <Field
          label="Output $ / million tokens"
          hint="Only used if the provider doesn't report each call's cost. OpenRouter does."
        >
          <NumberInput
            value={ai.outputPricePerM}
            step="any"
            onChange={(v) => set({ outputPricePerM: v ?? 0 })}
          />
        </Field>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="primary"
          onClick={() =>
            save({ ai: editable, ...(key ? { aiApiKey: key } : {}) }).then(() => setKey(""))
          }
        >
          Save AI settings
        </Button>
        {settings.ai.hasKey && (
          <Button variant="ghost" onClick={() => save({ aiApiKey: null })}>
            Remove key
          </Button>
        )}
        {saved && <span className="text-sm text-up">Saved</span>}
      </div>
      <div className="mt-3">
        <ErrorText error={error} />
      </div>
    </Card>
  );
}

function General({ settings }: { settings: Settings }) {
  const { save, saved, error } = useSaver();
  const [defaults, setDefaults] = useState(settings.defaults);
  const { data: status } = useStatus();
  return (
    <>
      <Card title="Defaults for new bots">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Dollars per trade">
            <NumberInput
              value={defaults.dollarsPerTrade}
              min={10}
              onChange={(v) => setDefaults({ ...defaults, dollarsPerTrade: v ?? 10 })}
            />
          </Field>
          <Field label="Daily loss limit $">
            <NumberInput
              value={defaults.dailyLossLimitUsd}
              min={0}
              onChange={(v) => setDefaults({ ...defaults, dailyLossLimitUsd: v ?? 0 })}
            />
          </Field>
          <Field
            label="Stock data feed"
            hint="IEX is free. SIP covers all exchanges and needs an Alpaca data subscription."
          >
            <Select
              value={settings.data.stockFeed}
              onChange={(stockFeed) => save({ data: { stockFeed } })}
              options={[
                { value: "iex", label: "IEX (free)" },
                { value: "sip", label: "SIP (paid)" },
              ]}
            />
          </Field>
        </div>
        <Button className="mt-4" onClick={() => save({ defaults })}>
          Save defaults
        </Button>
      </Card>
      <Card title="App">
        <div className="space-y-3">
          <Switch
            checked={settings.app.launchAtLogin}
            onChange={(v) => save({ app: { launchAtLogin: v } })}
            label="Open Exva when I log in"
          />
          <Switch
            checked={settings.app.keepRunningInTray}
            onChange={(v) => save({ app: { keepRunningInTray: v } })}
            label="Keep trading in the menu bar when the window is closed"
          />
          <Switch
            checked={settings.app.preventSleep}
            onChange={(v) => save({ app: { preventSleep: v } })}
            label="Keep the computer awake while bots run (a closed laptop lid still sleeps)"
          />
          <Switch
            checked={settings.app.notifications}
            onChange={(v) => save({ app: { notifications: v } })}
            label="Notifications for fills, problems and the morning journal"
          />
        </div>
        {saved && <div className="mt-3 text-sm text-up">Saved</div>}
        <div className="mt-3">
          <ErrorText error={error} />
        </div>
      </Card>
      <Card title="Safety">
        <div className="space-y-3 text-sm text-ink2">
          <Notice>
            Exva v2 only trades paper and simulator accounts. Live trading is not built in.
          </Notice>
          <Switch
            checked={settings.killSwitch}
            onChange={async (on) => {
              await api.killSwitch(on);
              save({});
            }}
            label="Kill switch: block every new order"
          />
          {status && (
            <div className="font-mono text-xs text-ink3">
              Engine {status.version} · {status.mode} mode · up since{" "}
              {new Date(status.startedAt).toLocaleString()}
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
