import type { InstrumentClass } from "@/lib/types";

export interface WorkspaceBrokerAccountRow {
  id: string;
  brokerType: string;
  supportedInstrumentClasses: InstrumentClass[];
}

function isCompatibleAccount(
  row: WorkspaceBrokerAccountRow | null | undefined,
  brokerType: string,
  instrumentClass: InstrumentClass,
): row is WorkspaceBrokerAccountRow {
  return (
    !!row &&
    row.brokerType === brokerType &&
    row.supportedInstrumentClasses.includes(instrumentClass)
  );
}

/**
 * Resolve a workspace market-data broker without the "first account of type"
 * shortcut. Prefer the global routing default for the instrument class; else
 * the sole compatible account. Ambiguous multi-account setups return null.
 */
export function resolveWorkspaceBrokerAccountId(input: {
  brokerType: string;
  instrumentClass: InstrumentClass;
  listAccounts: () => WorkspaceBrokerAccountRow[];
  findAccount: (id: string) => WorkspaceBrokerAccountRow | null | undefined;
  listGlobalDefaults: () => Array<{
    instrumentClass: string;
    defaultBrokerAccountId: string;
  }>;
}): string | null {
  const preferredId = input
    .listGlobalDefaults()
    .find(
      (row) => row.instrumentClass === input.instrumentClass,
    )?.defaultBrokerAccountId;
  if (preferredId) {
    const preferred = input.findAccount(preferredId);
    if (
      isCompatibleAccount(preferred, input.brokerType, input.instrumentClass)
    ) {
      return preferred.id;
    }
  }

  const matches = input
    .listAccounts()
    .filter((row) =>
      isCompatibleAccount(row, input.brokerType, input.instrumentClass),
    );
  return matches.length === 1 ? matches[0]!.id : null;
}
