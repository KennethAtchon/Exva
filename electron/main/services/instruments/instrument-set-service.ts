import type {
  InstrumentSetRevision,
  InstrumentSetMember,
  InstrumentSetStatus,
  InstrumentSetMode,
} from "@electron/shared/domain/experience-inputs/catalog";
import type { InstrumentClass } from "@electron/shared/domain/enums";
import { InstrumentSetRepo } from "./instrument-set-repo";
import { seedInstrumentSets } from "./instrument-set-seeds";

export class InstrumentSetService {
  constructor(private readonly repo: InstrumentSetRepo) {}

  list(): InstrumentSetRevision[] {
    return this.repo.list();
  }

  getActive(setId: string): InstrumentSetRevision | null {
    return this.repo.getActiveRevision(setId);
  }

  getRevision(setId: string, revision: number): InstrumentSetRevision | null {
    return this.repo.getRevision(setId, revision);
  }

  requireActive(setId: string): InstrumentSetRevision {
    const rev = this.repo.getActiveRevision(setId);
    if (!rev) {
      throw new Error(
        `InstrumentSetService: no active revision for set "${setId}"`,
      );
    }
    return rev;
  }

  listMembers(setId: string, revision: number): InstrumentSetMember[] {
    return this.repo.listMembers(setId, revision);
  }

  /**
   * Create a new revision of an instrument set, replacing members.
   * The set header is created if absent; revision number is auto-incremented.
   */
  createRevision(input: {
    setId: string;
    name: string;
    instrumentClass: InstrumentClass;
    mode: InstrumentSetMode;
    status: InstrumentSetStatus;
    members: Array<{
      canonicalId: string;
      displaySymbol: string;
      venue?: string | null;
    }>;
  }): InstrumentSetRevision {
    this.repo.ensureSet(input.setId);
    const existing = this.repo.getActiveRevision(input.setId);
    const nextRevision = existing ? existing.revision + 1 : 1;
    return this.repo.createRevision({ ...input, revision: nextRevision });
  }

  /**
   * Seed all built-in instrument sets. Idempotent.
   */
  seed(): void {
    seedInstrumentSets(this.repo);
  }
}
