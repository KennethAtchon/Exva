import { describe, expect, it } from "vitest";
import type {
  AutopsyLesson,
  AutopsyStructured,
} from "@electron/shared/domain/autopsy";
import {
  extractKeywords,
  lessonMatchesStructured,
  runLessonValidation,
} from "../trade-autopsy-service";

function makeStructured(
  overrides: Partial<AutopsyStructured> = {},
): AutopsyStructured {
  return {
    executiveSummary: "Summary",
    thesisReview: {
      valid: true,
      analysis: "ok",
      confirmatoryBias: false,
      prematureConviction: false,
      ignoredCounterSignals: [],
    },
    executionQuality: {
      entryTiming: "good",
      sizingAdequacy: "appropriate",
      exitManagement: "Held to target",
      slippage: null,
    },
    behavioralFlags: [],
    marketContext: {
      regime: "trending",
      macro: "Risk-on",
      volatility: "Normal",
      suitability: "good_conditions",
    },
    whatWorked: ["Good entry"],
    whatFailed: [],
    rootCause: null,
    processImprovements: ["Keep doing this"],
    ...overrides,
  };
}

function makeLesson(
  overrides: Partial<AutopsyLesson> = {},
): AutopsyLesson {
  return {
    id: "lesson-1",
    autopsyId: "autopsy-1",
    tradeId: "trade-1",
    sessionId: "session-1",
    lesson: "Avoid moving stop loss during drawdown",
    severity: "high",
    category: "behavioral",
    proposedFix: "Lock stop after entry",
    status: "pending",
    recurrenceCount: 1,
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    validatedAt: null,
    ...overrides,
  };
}

describe("extractKeywords", () => {
  it("filters stopwords and short tokens", () => {
    expect(extractKeywords("Avoid moving stop loss during drawdown")).toEqual([
      "avoid",
      "moving",
      "stop",
      "loss",
      "drawdown",
    ]);
  });
});

describe("lessonMatchesStructured", () => {
  it("matches when keywords appear in behavioral flags", () => {
    const lesson = makeLesson({
      lesson: "Stop loss was moved too early",
    });
    const structured = makeStructured({
      behavioralFlags: [
        {
          flag: "stop_moved",
          description: "Agent moved stop loss after minor pullback",
          severity: "high",
        },
      ],
    });
    expect(lessonMatchesStructured(lesson, structured)).toBe(true);
  });

  it("matches when keywords appear in whatFailed", () => {
    const lesson = makeLesson({ lesson: "Revenge trading after loss" });
    const structured = makeStructured({
      whatFailed: ["Revenge entry after prior stop-out"],
    });
    expect(lessonMatchesStructured(lesson, structured)).toBe(true);
  });
});

describe("runLessonValidation", () => {
  it("increments recurrence and marks recurring after second match", () => {
    const structured = makeStructured({
      whatFailed: ["Stop loss moved during drawdown"],
    });
    const { updates, andonCords } = runLessonValidation({
      sessionId: "session-1",
      structured,
      priorLessons: [makeLesson({ recurrenceCount: 1, status: "pending" })],
      recentStructuredByTrade: new Map(),
    });

    expect(updates).toEqual([
      {
        lessonId: "lesson-1",
        recurrenceCount: 2,
        status: "recurring",
      },
    ]);
    expect(andonCords).toEqual([]);
  });

  it("fires andon cord for high severity recurring lessons", () => {
    const structured = makeStructured({
      whatFailed: ["Stop loss moved during drawdown"],
    });
    const { andonCords } = runLessonValidation({
      sessionId: "session-1",
      structured,
      priorLessons: [
        makeLesson({
          recurrenceCount: 2,
          status: "recurring",
          severity: "critical",
        }),
      ],
      recentStructuredByTrade: new Map(),
    });

    expect(andonCords).toHaveLength(1);
    expect(andonCords[0]?.recurrenceCount).toBe(3);
  });

  it("validates implemented lessons after five clean trades", () => {
    const structured = makeStructured();
    const recentStructuredByTrade = new Map<string, AutopsyStructured | null>([
      ["t1", makeStructured()],
      ["t2", makeStructured()],
      ["t3", makeStructured()],
      ["t4", makeStructured()],
      ["t5", makeStructured()],
    ]);
    const { updates } = runLessonValidation({
      sessionId: "session-1",
      structured,
      priorLessons: [
        makeLesson({
          status: "implemented",
          lesson: "Unique issue not seen recently",
        }),
      ],
      recentStructuredByTrade,
    });

    expect(updates).toEqual([
      {
        lessonId: "lesson-1",
        status: "validated",
        validatedAt: expect.any(String),
      },
    ]);
  });
});
