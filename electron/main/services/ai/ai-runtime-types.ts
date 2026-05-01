import type { AgentRun } from "@/lib/types";

export interface AgentResult<T> {
  run: AgentRun;
  output: T;
}
