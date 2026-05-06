import type { AgentMessage, AgentRun } from "@/lib/types";

export interface AgentResult<T> {
  run: AgentRun;
  message: AgentMessage;
  output: T;
}
