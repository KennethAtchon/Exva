import type { SourceDefinition } from "@electron/shared/domain/experience-inputs/catalog";
import type { LiveSignalSourceType } from "@electron/shared/domain/signals";
import { SourceDefinitionRepo } from "./source-definition-repo";
import { seedSourceDefinitions } from "./source-definition-seeds";

export class SourceDefinitionService {
  constructor(private readonly repo: SourceDefinitionRepo) {}

  list(): SourceDefinition[] {
    return this.repo.list();
  }

  listByKind(kind: LiveSignalSourceType): SourceDefinition[] {
    return this.repo.listByKind(kind);
  }

  get(id: string): SourceDefinition | null {
    return this.repo.get(id);
  }

  require(id: string): SourceDefinition {
    const def = this.repo.get(id);
    if (!def) {
      throw new Error(
        `SourceDefinitionService: source definition "${id}" not found`,
      );
    }
    return def;
  }

  /**
   * Seed all built-in source definitions. Idempotent.
   */
  seed(): void {
    seedSourceDefinitions(this.repo);
  }
}
