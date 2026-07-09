/**
 * Prisma implementation of CustomerRepo. Semantics exactly like
 * src/persistence/inmemory/customer.repo.ts: `save` is an upsert-by-id (role sync from the
 * CRM); `findByRole` uses the Postgres array filter `has` on the audience-key array.
 */
import { Injectable } from '@nestjs/common';
import type { CustomerRepo } from '../../domain/ports';
import type { Customer } from '../../domain/types';
import { toDomain, toUpsertData } from './mappers/customer.mapper';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaCustomerRepo implements CustomerRepo {
  constructor(private readonly prisma: PrismaService) {}

  async save(customer: Customer): Promise<Customer> {
    const data = toUpsertData(customer);
    const row = await this.prisma.customer.upsert({
      where: { id: customer.id },
      create: { id: customer.id, ...data },
      update: data,
    });
    return toDomain(row);
  }

  async findById(id: string): Promise<Customer | undefined> {
    const row = await this.prisma.customer.findUnique({ where: { id } });
    return row ? toDomain(row) : undefined;
  }

  async findAllByExternalRef(externalRef: string): Promise<Customer[]> {
    const rows = await this.prisma.customer.findMany({ where: { externalRef } });
    return rows.map(toDomain);
  }

  async findByRole(audienceKey: string): Promise<Customer[]> {
    const rows = await this.prisma.customer.findMany({ where: { roles: { has: audienceKey } } });
    return rows.map(toDomain);
  }

  async findAll(): Promise<Customer[]> {
    const rows = await this.prisma.customer.findMany();
    return rows.map(toDomain);
  }

  async findBySource(source: string): Promise<Customer[]> {
    const rows = await this.prisma.customer.findMany({ where: { source } });
    return rows.map(toDomain);
  }

  async softDelete(id: string, at: Date): Promise<void> {
    // updateMany (not update) so an unknown id is a silent no-op rather than P2025.
    await this.prisma.customer.updateMany({ where: { id }, data: { deletedAt: at } });
  }
}
