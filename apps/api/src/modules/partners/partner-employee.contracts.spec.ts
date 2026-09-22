import type {
  PartnerEmployeeCardAssignmentDto as SharedAssignmentDto,
  PartnerEmployeeCardDto as SharedCardDto,
} from '@tutak/shared-types';
import type {
  PartnerEmployeeCard,
  PartnerEmployeeCardAssignment,
} from './partner-employee.service';

/**
 * The employee card the API returns and the one the panel reads must be the
 * same shape.
 *
 * Written twice because `apps/api` cannot import `@tutak/shared-types` in
 * its build — `rootDir` is `apps/api/src` and the cross-workspace import
 * fails with TS6059. This spec compiles with the workspace root as its
 * `rootDir` and sees both trees, so the compiler does the work: the mutual
 * assignments stop building the moment a field is added, removed or retyped
 * on one side only.
 *
 * The runtime assertion is the one thing the types cannot state — that the
 * card carries no contact details. A `phone` added to the shared DTO and
 * mirrored here would type-check perfectly and would be exactly the leak the
 * card was kept narrow to avoid.
 */
describe('the employee card stays in step with @tutak/shared-types', () => {
  const assignment: PartnerEmployeeCardAssignment = {
    branchId: 'branch-1',
    branchName: 'North',
    branchAddress: 'North 1',
    role: 'STAFF',
    isActive: true,
    assignedAt: '2026-03-01T10:00:00.000Z',
    deactivatedAt: null,
  };

  const card: PartnerEmployeeCard = {
    code: 'EMP-007',
    firstName: 'Արամ',
    lastName: 'Հակոբյան',
    assignments: [assignment],
    roles: [{ role: 'PARTNER_STAFF', allBranches: false }],
  };

  it('an assignment is the same object on both sides', () => {
    const shared: SharedAssignmentDto = assignment;
    const back: PartnerEmployeeCardAssignment = shared;
    expect(back).toEqual(assignment);
  });

  it('a card is the same object on both sides', () => {
    const shared: SharedCardDto = card;
    const back: PartnerEmployeeCard = shared;
    expect(back).toEqual(card);
  });

  it('carries no way to contact the person', () => {
    const keys = Object.keys(card);
    for (const contact of ['phone', 'email', 'userId', 'id']) {
      expect(keys).not.toContain(contact);
    }
    expect(Object.keys(assignment)).not.toContain('userId');
  });
});
