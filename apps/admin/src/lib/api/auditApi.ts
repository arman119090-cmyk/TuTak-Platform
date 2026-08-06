import { httpClient, ApiEnvelope } from '../httpClient';

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; firstName: string; lastName: string; phone: string } | null;
}

export interface FraudSignalDto {
  id: string;
  type: string;
  severity: string;
  userId: string | null;
  relatedTransactionId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export const auditApi = {
  async list(cursor?: string) {
    const { data } = await httpClient.get<ApiEnvelope<{ items: AuditLogDto[]; nextCursor: string | null }>>(
      '/admin/audit-logs',
      { params: { cursor } },
    );
    return data.data;
  },
};

export const securityApi = {
  async listOpenFraudSignals() {
    const { data } = await httpClient.get<ApiEnvelope<FraudSignalDto[]>>('/admin/fraud-signals');
    return data.data;
  },
  async resolve(id: string) {
    await httpClient.post(`/admin/fraud-signals/${id}/resolve`);
  },
};
