import type { CustomerRepo } from '../../domain/ports.js';
import type { Customer } from '../../domain/types.js';
import { deepCopy } from './clone.js';

export class InMemoryCustomerRepo implements CustomerRepo {
  private readonly customers = new Map<string, Customer>();

  async save(customer: Customer): Promise<Customer> {
    this.customers.set(customer.id, deepCopy(customer));
    return deepCopy(customer);
  }

  async findById(id: string): Promise<Customer | undefined> {
    return deepCopy(this.customers.get(id));
  }

  async findAllByExternalRef(externalRef: string): Promise<Customer[]> {
    return deepCopy([...this.customers.values()].filter((c) => c.externalRef === externalRef));
  }

  async findByRole(audienceKey: string): Promise<Customer[]> {
    return deepCopy([...this.customers.values()].filter((c) => c.roles.includes(audienceKey)));
  }

  async findAll(): Promise<Customer[]> {
    return deepCopy([...this.customers.values()]);
  }

  async softDelete(id: string, at: Date): Promise<void> {
    const existing = this.customers.get(id);
    if (existing) {
      this.customers.set(id, { ...existing, deletedAt: at });
    }
  }
}
