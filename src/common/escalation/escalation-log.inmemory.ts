import { deepCopy } from '../../persistence/inmemory/clone';
import type { EscalationEntry, EscalationLog } from './escalation-log';

/** In-memory implementation (tests + REPOSITORY_DRIVER=inmemory). */
export class InMemoryEscalationLog implements EscalationLog {
  private readonly entries: EscalationEntry[] = [];

  async record(entry: EscalationEntry): Promise<EscalationEntry> {
    this.entries.push(deepCopy(entry));
    return deepCopy(entry);
  }

  async findByCustomer(customerId: string): Promise<EscalationEntry[]> {
    return deepCopy(this.entries.filter((e) => e.customerId === customerId));
  }

  async findAll(): Promise<EscalationEntry[]> {
    return deepCopy(this.entries);
  }
}
