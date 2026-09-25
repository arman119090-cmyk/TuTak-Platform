import type {
  CommissionRuleDto,
  CreateCommissionRuleRequestDto,
  OrderEscalationDto,
  RecordSourcingResultRequestDto,
  SourcingTaskDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

/** TuTak staff/admin side of Partner Commerce — spec §13, §21. */
export const partnerOrderAdminApi = {
  async listSourcingTasks() {
    const { data } = await httpClient.get<ApiEnvelope<SourcingTaskDto[]>>(
      '/admin/partner-orders/sourcing-tasks',
    );
    return data.data;
  },
  async claimSourcingTask(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<SourcingTaskDto>>(
      `/admin/partner-orders/sourcing-tasks/${id}/claim`,
    );
    return data.data;
  },
  async recordSourcingResult(id: string, dto: RecordSourcingResultRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<SourcingTaskDto>>(
      `/admin/partner-orders/sourcing-tasks/${id}/result`,
      dto,
    );
    return data.data;
  },

  async listEscalations() {
    const { data } = await httpClient.get<ApiEnvelope<OrderEscalationDto[]>>(
      '/admin/partner-orders/escalations',
    );
    return data.data;
  },
  async claimEscalation(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<OrderEscalationDto>>(
      `/admin/partner-orders/escalations/${id}/claim`,
    );
    return data.data;
  },
  async resolveEscalation(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<OrderEscalationDto>>(
      `/admin/partner-orders/escalations/${id}/resolve`,
    );
    return data.data;
  },

  async listCommissionRules(partnerId?: string) {
    const { data } = await httpClient.get<ApiEnvelope<CommissionRuleDto[]>>(
      '/admin/partner-orders/commission-rules',
      { params: { partnerId } },
    );
    return data.data;
  },
  async createCommissionRule(dto: CreateCommissionRuleRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<CommissionRuleDto>>(
      '/admin/partner-orders/commission-rules',
      dto,
    );
    return data.data;
  },
  async deactivateCommissionRule(id: string) {
    await httpClient.post(`/admin/partner-orders/commission-rules/${id}/deactivate`);
  },
};
