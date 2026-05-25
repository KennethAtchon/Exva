import fs from "node:fs";
import path from "node:path";
import { dialog, BrowserWindow, type WebContents } from "electron";
import {
  parseAutopsyStructuredJson,
  type AutopsyLesson,
  type AutopsyStructured,
  type ExportFormat,
  type ExportResult,
  type TradeAutopsyRecord,
} from "@electron/shared/domain/autopsy";
import type { Trade } from "@/lib/types";

export class AutopsyExportService {
  async export(
    format: ExportFormat,
    autopsyRecord: TradeAutopsyRecord,
    lessons: AutopsyLesson[],
    trade: Trade,
    sessionName: string,
    webContents?: WebContents,
  ): Promise<ExportResult> {
    const structured = parseAutopsyStructuredJson(
      autopsyRecord.summaryStructuredJson,
    );
    const defaultName = buildDefaultFilename(trade, autopsyRecord.createdAt, format);

    const saveResult = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: fileFilters(format),
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return { cancelled: true };
    }

    try {
      if (format === "markdown") {
        const markdown = renderMarkdown(
          autopsyRecord,
          structured,
          lessons,
          trade,
          sessionName,
        );
        fs.writeFileSync(saveResult.filePath, markdown, "utf8");
      } else if (format === "json") {
        const payload = {
          autopsy: autopsyRecord,
          structured,
          lessons,
          trade: {
            id: trade.id,
            instrumentSymbol: trade.instrumentSymbol,
            side: trade.side,
            strategy: trade.strategy,
            final_pnl_usd: trade.final_pnl_usd,
          },
          sessionName,
        };
        fs.writeFileSync(
          saveResult.filePath,
          JSON.stringify(payload, null, 2),
          "utf8",
        );
      } else {
        if (!webContents) {
          return { error: "PDF export requires an active renderer window." };
        }
        const html = renderHtml(
          autopsyRecord,
          structured,
          lessons,
          trade,
          sessionName,
        );
        await exportPdf(html, saveResult.filePath);
      }

      return {
        path: saveResult.filePath,
        filename: path.basename(saveResult.filePath),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

async function exportPdf(
  html: string,
  filePath: string,
): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true },
  });

  const timeout = setTimeout(() => {
    if (!win.isDestroyed()) win.close();
  }, 10_000);

  try {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: "default" },
    });
    fs.writeFileSync(filePath, pdf);
  } finally {
    clearTimeout(timeout);
    if (!win.isDestroyed()) win.close();
  }
}

function fileFilters(format: ExportFormat) {
  switch (format) {
    case "markdown":
      return [{ name: "Markdown", extensions: ["md"] }];
    case "json":
      return [{ name: "JSON", extensions: ["json"] }];
    case "pdf":
      return [{ name: "PDF", extensions: ["pdf"] }];
  }
}

function buildDefaultFilename(
  trade: Trade,
  createdAt: string,
  format: ExportFormat,
): string {
  const date = createdAt.slice(0, 10);
  const ext = format === "markdown" ? "md" : format;
  return `autopsy-${trade.instrumentSymbol}-${date}.${ext}`;
}

function renderMarkdown(
  autopsy: TradeAutopsyRecord,
  structured: AutopsyStructured | null,
  lessons: AutopsyLesson[],
  trade: Trade,
  sessionName: string,
): string {
  const s = structured;
  const lines: string[] = [
    `# Trade Autopsy — ${trade.instrumentSymbol} ${trade.side} · ${autopsy.createdAt.slice(0, 10)}`,
    "",
    `**Grade:** ${autopsy.qualityGrade ?? "N/A"}  **Score:** ${autopsy.qualityScore ?? "N/A"}/100  **P&L:** ${trade.final_pnl_usd ?? 0}`,
    `**Model:** ${autopsy.modelId}  **Generated:** ${autopsy.createdAt}`,
    `**Session:** ${sessionName}  **Strategy:** ${trade.strategy}`,
    "",
    "---",
    "",
    "## Executive Summary",
    "",
    s?.executiveSummary ?? autopsy.summary,
    "",
  ];

  if (s) {
    lines.push(
      "## Thesis Review",
      "",
      `- Valid thesis: ${s.thesisReview.valid ?? "Uncertain"}`,
      `- Confirmatory bias: ${s.thesisReview.confirmatoryBias ? "Yes" : "No"}`,
      `- Ignored counter-signals: ${s.thesisReview.ignoredCounterSignals.join(", ") || "None"}`,
      "",
      s.thesisReview.analysis,
      "",
      "## Execution Quality",
      "",
      `- Entry timing: ${s.executionQuality.entryTiming}`,
      `- Sizing: ${s.executionQuality.sizingAdequacy}`,
      `- Exit management: ${s.executionQuality.exitManagement}`,
      `- Slippage: ${s.executionQuality.slippage ?? "None"}`,
      "",
      "## Behavioral Flags",
      "",
    );
    if (s.behavioralFlags.length === 0) {
      lines.push("No behavioral flags detected.", "");
    } else {
      for (const flag of s.behavioralFlags) {
        lines.push(
          `- **${flag.flag}** (${flag.severity}): ${flag.description}`,
        );
      }
      lines.push("");
    }

    lines.push(
      "## Market Context",
      "",
      `- Regime: ${s.marketContext.regime}`,
      `- Suitability: ${s.marketContext.suitability}`,
      `- Macro: ${s.marketContext.macro}`,
      `- Volatility: ${s.marketContext.volatility}`,
      "",
      "## What Worked",
      "",
      ...s.whatWorked.map((item) => `- ${item}`),
      "",
      "## What Failed",
      "",
      ...s.whatFailed.map((item) => `- ${item}`),
      "",
      "## Root Cause",
      "",
      s.rootCause ?? "N/A — winning trade or no root cause identified.",
      "",
      "## Process Improvements",
      "",
      ...s.processImprovements.map((item, index) => `${index + 1}. ${item}`),
      "",
    );
  }

  if (lessons.length > 0) {
    lines.push("## Lessons", "");
    for (const lesson of lessons) {
      lines.push(
        `### ${lesson.category} — ${lesson.severity}`,
        lesson.lesson,
        `**Proposed fix:** ${lesson.proposedFix}`,
        `**Status:** ${lesson.status}`,
        "",
      );
    }
  }

  lines.push("---", `*Generated by Exva · Trade ID: ${trade.id}*`);
  return lines.join("\n");
}

function renderHtml(
  autopsy: TradeAutopsyRecord,
  structured: AutopsyStructured | null,
  lessons: AutopsyLesson[],
  trade: Trade,
  sessionName: string,
): string {
  const markdown = renderMarkdown(
    autopsy,
    structured,
    lessons,
    trade,
    sessionName,
  );
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px; color: #111; line-height: 1.5; }
    pre { white-space: pre-wrap; font-family: inherit; }
  </style>
</head>
<body><pre>${escaped}</pre></body>
</html>`;
}
