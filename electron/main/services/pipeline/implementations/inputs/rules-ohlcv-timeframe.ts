import {
  defaultBarCountForTimeframe,
  parseSignalInstrumentMetadata,
  resolveOhlcvTimeframe,
} from "@electron/shared/domain/signal-timing";

export function resolveRulesOhlcvRequest(
  metadataJson: string | null | undefined,
): {
  timeframe: ReturnType<typeof resolveOhlcvTimeframe>;
  barCount: number;
} {
  const metadata = parseSignalInstrumentMetadata(metadataJson);
  const timeframe = resolveOhlcvTimeframe(metadata, "1h");
  return {
    timeframe,
    barCount: defaultBarCountForTimeframe(timeframe),
  };
}
