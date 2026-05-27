import React, { useReducer, type Reducer } from "react";
import { cn } from "@/lib/utils";
import type { InstrumentClass } from "@/lib/types";
import {
  DEFAULT_MOCK_SCENARIO_KIND,
  MOCK_SCENARIO_KINDS,
  MOCK_SCENARIO_LABELS,
  type MockScenarioKind,
} from "@electron/shared/domain/mock-scenario";
import { api } from "@/lib/exva";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { ShadcnSelect } from "@/components/custom-ui";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components/ui";

type BrokerType =
  | "alpaca"
  | "coinbase_advanced_trade"
  | "tradovate"
  | "polymarket"
  | "mock";

interface FormState {
  brokerType: BrokerType;
  mockScenarioKind: MockScenarioKind;
  name: string;
  apiKey: string;
  secretKey: string;
  passphrase: string;
  username: string;
  password: string;
  privateKey: string;
  funderAddress: string;
}

interface ReqState {
  testing: boolean;
  saving: boolean;
  testOk: boolean | null;
  message: string | null;
}

function mergeReducer<S>(state: S, update: Partial<S>): S {
  return { ...state, ...update };
}

const labelClass = "mb-1.5 text-[12px] font-medium text-[var(--text2)]";

const inputClass =
  "h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]";

const CredentialFields = ({
  brokerType,
  form,
  dispatch,
}: {
  brokerType: BrokerType;
  form: FormState;
  dispatch: React.Dispatch<Partial<FormState>>;
}) => {
  const {
    apiKey,
    secretKey,
    passphrase,
    username,
    password,
    privateKey,
    funderAddress,
  } = form;

  if (brokerType === "alpaca") {
    return (
      <>
        <div className="mb-3">
          <div className={labelClass}>API key ID</div>
          <Input
            className={inputClass}
            value={apiKey}
            onChange={(e) => dispatch({ apiKey: e.target.value })}
            type="password"
          />
        </div>
        <div className="mb-3">
          <div className={labelClass}>Secret key</div>
          <Input
            className={inputClass}
            value={secretKey}
            onChange={(e) => dispatch({ secretKey: e.target.value })}
            type="password"
          />
        </div>
      </>
    );
  }

  if (brokerType === "coinbase_advanced_trade") {
    return (
      <>
        <div className="mb-3">
          <div className={labelClass}>API key</div>
          <Input
            className={inputClass}
            value={apiKey}
            onChange={(e) => dispatch({ apiKey: e.target.value })}
            type="password"
          />
        </div>
        <div className="mb-3">
          <div className={labelClass}>API secret (CDP EC private key, PEM)</div>
          <Input
            className={inputClass}
            value={secretKey}
            onChange={(e) => dispatch({ secretKey: e.target.value })}
            type="password"
          />
        </div>
        <div className="mb-3">
          <div className={labelClass}>Passphrase (if required)</div>
          <Input
            className={inputClass}
            value={passphrase}
            onChange={(e) => dispatch({ passphrase: e.target.value })}
            type="password"
          />
        </div>
      </>
    );
  }

  if (brokerType === "tradovate") {
    return (
      <>
        <div className="mb-3">
          <div className={labelClass}>Username</div>
          <Input
            className={inputClass}
            value={username}
            onChange={(e) => dispatch({ username: e.target.value })}
          />
        </div>
        <div className="mb-3">
          <div className={labelClass}>Password</div>
          <Input
            className={inputClass}
            value={password}
            onChange={(e) => dispatch({ password: e.target.value })}
            type="password"
          />
        </div>
      </>
    );
  }

  if (brokerType === "polymarket") {
    return (
      <>
        <div className="mb-3">
          <div className={labelClass}>Polygon private key</div>
          <Input
            className={inputClass}
            value={privateKey}
            onChange={(e) => dispatch({ privateKey: e.target.value })}
            type="password"
          />
        </div>
        <div className="mb-3">
          <div className={labelClass}>Polymarket funder/profile address</div>
          <Input
            className={inputClass}
            value={funderAddress}
            onChange={(e) => dispatch({ funderAddress: e.target.value })}
          />
        </div>
      </>
    );
  }

  return null;
};

const TestResult = ({
  message,
  testOk,
}: {
  message: string | null;
  testOk: boolean | null;
}) => {
  if (!message) return null;
  return (
    <div
      className={cn(
        "mb-3 rounded-lg px-2.5 py-2 text-[12px]",
        testOk ? "bg-success-dim text-success" : "bg-error-dim text-error",
      )}
    >
      {message}
    </div>
  );
};

export const AddBrokerModal = ({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) => {
  const environmentMode = useWorkspaceStore((s) => s.environmentMode);

  const [form, dispatchForm] = useReducer<
    Reducer<FormState, Partial<FormState>>
  >(mergeReducer, {
    brokerType: "mock",
    mockScenarioKind: DEFAULT_MOCK_SCENARIO_KIND,
    name: "",
    apiKey: "",
    secretKey: "",
    passphrase: "",
    username: "",
    password: "",
    privateKey: "",
    funderAddress: "",
  });
  const [req, dispatchReq] = useReducer<Reducer<ReqState, Partial<ReqState>>>(
    mergeReducer,
    {
      testing: false,
      saving: false,
      testOk: null,
      message: null,
    },
  );
  const {
    brokerType,
    mockScenarioKind,
    name,
    apiKey,
    secretKey,
    passphrase,
    username,
    password,
    privateKey,
    funderAddress,
  } = form;
  const { testing, saving, testOk, message } = req;

  if (!open) return null;

  const credentials = (): Record<string, string> => {
    switch (brokerType) {
      case "alpaca":
        return { api_key: apiKey, secret_key: secretKey };
      case "coinbase_advanced_trade":
        return { apiKey, apiSecret: secretKey, passphrase };
      case "tradovate":
        return { username, password };
      case "polymarket":
        return { privateKey, funderAddress };
      default:
        return {};
    }
  };

  const runTest = async () => {
    dispatchReq({ testing: true, message: null });
    try {
      const result = await api.testBrokerCredentials({
        brokerType,
        mode: environmentMode,
        credentials: credentials(),
      });
      dispatchReq({ testOk: result.ok, message: result.message });
    } catch (e) {
      dispatchReq({
        testOk: false,
        message: e instanceof Error ? e.message : "Test failed",
      });
    } finally {
      dispatchReq({ testing: false });
    }
  };

  const save = async () => {
    dispatchReq({ saving: true, message: null });
    try {
      const result = await api.registerBrokerAccount({
        brokerType,
        name: name.trim() || `${brokerType} account`,
        mode: environmentMode,
        credentials: credentials(),
        ...(brokerType === "mock" ? { mockScenarioKind } : {}),
      });
      if (!result.ok) {
        dispatchReq({ message: result.message });
        return;
      }
      await onSaved();
      onClose();
      dispatchForm({
        name: "",
        apiKey: "",
        secretKey: "",
        passphrase: "",
        username: "",
        password: "",
        privateKey: "",
        funderAddress: "",
      });
      dispatchReq({ testOk: null });
    } catch (e) {
      dispatchReq({ message: e instanceof Error ? e.message : "Save failed" });
    } finally {
      dispatchReq({ saving: false });
    }
  };

  const supportedHint = (): InstrumentClass[] => {
    switch (brokerType) {
      case "alpaca":
        return ["stock"];
      case "coinbase_advanced_trade":
        return ["crypto"];
      case "tradovate":
        return ["futures"];
      case "polymarket":
        return ["prediction_market"];
      default:
        return ["stock", "crypto", "futures", "prediction_market"];
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-xl border-border bg-[var(--surface)] p-5 sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[var(--text1)]">
            Add broker account
          </DialogTitle>
        </DialogHeader>

        <div className="mb-3">
          <div className={labelClass}>Broker type</div>
          <ShadcnSelect
            value={brokerType}
            onValueChange={(value) => {
              const next = value as typeof brokerType;
              dispatchForm({ brokerType: next });
              dispatchReq({ testOk: null, message: null });
            }}
            options={[
              { value: "mock", label: "Mock (dev — all instrument classes)" },
              { value: "alpaca", label: "Alpaca (stocks)" },
              {
                value: "coinbase_advanced_trade",
                label: "Coinbase Advanced Trade (crypto — CCXT)",
              },
              {
                value: "tradovate",
                label: "Tradovate (futures — simulated v1)",
              },
              { value: "polymarket", label: "Polymarket (prediction markets)" },
            ]}
          />
          <div className="mt-1.5 text-[12px] text-[var(--text3)]">
            Supports: {supportedHint().join(", ")}
          </div>
        </div>

        {brokerType === "mock" && (
          <div className="mb-3">
            <div className={labelClass}>Mock scenario</div>
            <ShadcnSelect
              value={mockScenarioKind}
              onValueChange={(value) =>
                dispatchForm({ mockScenarioKind: value as MockScenarioKind })
              }
              options={MOCK_SCENARIO_KINDS.map((kind) => ({
                value: kind,
                label: `${MOCK_SCENARIO_LABELS[kind].label} ${MOCK_SCENARIO_LABELS[kind].outcome}`,
              }))}
            />
            <div className="mt-1.5 text-[12px] text-[var(--text3)]">
              Use Clean breakout to verify the bot selects, decides, and fills a
              trade end-to-end.
            </div>
          </div>
        )}

        <div className="mb-3">
          <div className={labelClass}>Display name</div>
          <Input
            className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]"
            value={name}
            onChange={(e) => dispatchForm({ name: e.target.value })}
            placeholder="e.g. Main Alpaca"
          />
        </div>

        <CredentialFields
          brokerType={brokerType}
          form={form}
          dispatch={dispatchForm}
        />

        <TestResult message={message} testOk={testOk} />

        <div className="mt-2 flex gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => void runTest()}
            disabled={testing}
            className="flex-1 border-border bg-[var(--surface2)] text-[var(--text2)]"
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving || testOk !== true}
            className="flex-1 bg-[var(--accent)] text-[hsl(var(--primary-foreground))] hover:opacity-95 disabled:opacity-45"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="flex-1 border-border bg-[var(--surface2)] text-[var(--text2)]"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
