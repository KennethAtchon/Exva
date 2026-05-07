const SENSITIVE_KEY_PATTERN = /(key|secret|token|password|authorization|cookie|credential|api[_-]?key)/i;

export type PayloadLogMeta = {
  sizeBytes: number;
  tooLarge: boolean;
  sensitiveKeyDetected: boolean;
  sensitiveKeyCount: number;
};

function inspect(value: unknown, meta: { sensitiveKeyCount: number }, depth: number): void {
  if (depth > 4 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) inspect(item, meta, depth + 1);
    return;
  }
  if (typeof value !== "object") return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      meta.sensitiveKeyCount += 1;
    }
    inspect(child, meta, depth + 1);
  }
}

export function payloadMeta(payload: unknown, maxBytes = 4000): PayloadLogMeta {
  let serialized = "";
  try {
    serialized = JSON.stringify(payload) ?? "";
  } catch {
    serialized = "[unserializable]";
  }

  const meta = { sensitiveKeyCount: 0 };
  inspect(payload, meta, 0);

  return {
    sizeBytes: Buffer.byteLength(serialized),
    tooLarge: Buffer.byteLength(serialized) > maxBytes,
    sensitiveKeyDetected: meta.sensitiveKeyCount > 0,
    sensitiveKeyCount: meta.sensitiveKeyCount,
  };
}

export function textMeta(value: string | null | undefined, maxChars = 800): {
  length: number;
  tooLong: boolean;
  looksSensitive: boolean;
} {
  const text = value ?? "";
  return {
    length: text.length,
    tooLong: text.length > maxChars,
    looksSensitive: SENSITIVE_KEY_PATTERN.test(text),
  };
}
