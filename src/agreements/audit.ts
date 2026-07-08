/**
 * Admin audit log (auditability): every admin mutation (publish, manual acceptance,
 * deadline extension/block suspension, reminder) is logged with actor + mandatory reason +
 * timestamp. The port is defined here in the agreements module (lowest layer) so both the
 * PublishService (agreements) and the admin services can write to it — without a cycle
 * (admin → agreements).
 */
export type AdminAuditAction =
  | 'PUBLISH'
  | 'MANUAL_ACCEPTANCE'
  | 'CUSTOMER_VERSION_STATE_PATCH'
  | 'REMIND'
  | 'AUDIENCE_CREATE'
  | 'AUDIENCE_UPDATE'
  | 'AUDIENCE_DELETE'
  | 'DOCUMENT_TYPE_CREATE'
  | 'DOCUMENT_TYPE_UPDATE'
  | 'DOCUMENT_TYPE_DELETE'
  | 'CUSTOMER_CREATE'
  | 'CUSTOMER_UPDATE'
  | 'ACCEPTANCE_LINK_CREATE'
  | 'EMAIL_TEMPLATE_CREATE'
  | 'EMAIL_TEMPLATE_UPDATE'
  | 'EMAIL_TEMPLATE_DELETE';

export interface AdminAuditLog {
  id: string;
  action: AdminAuditAction;
  /** Admin user (from the auth context, never from the body). */
  actor: string;
  targetType: string;
  targetId: string;
  /** Mandatory for manual acceptance/PATCH; otherwise optional. */
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface AdminAuditRepo {
  append(log: AdminAuditLog): Promise<AdminAuditLog>;
  findAll(): Promise<AdminAuditLog[]>;
  findByTarget(targetType: string, targetId: string): Promise<AdminAuditLog[]>;
}

/** In-memory AdminAuditRepo for tests (append-only). */
export class InMemoryAdminAuditRepo implements AdminAuditRepo {
  private readonly logs: AdminAuditLog[] = [];

  async append(log: AdminAuditLog): Promise<AdminAuditLog> {
    this.logs.push({ ...log });
    return { ...log };
  }

  async findAll(): Promise<AdminAuditLog[]> {
    return this.logs.map((l) => ({ ...l }));
  }

  async findByTarget(targetType: string, targetId: string): Promise<AdminAuditLog[]> {
    return this.logs
      .filter((l) => l.targetType === targetType && l.targetId === targetId)
      .map((l) => ({ ...l }));
  }
}

/** DI token of the audit port (wired by the integration layer or tests). */
export const ADMIN_AUDIT_TOKEN = Symbol('AdminAuditRepo');
