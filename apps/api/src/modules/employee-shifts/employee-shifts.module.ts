import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmployeeShiftService } from './employee-shift.service';
import { EmployeeShiftsController } from './employee-shifts.controller';

@Module({
  imports: [AuditModule],
  controllers: [EmployeeShiftsController],
  providers: [EmployeeShiftService],
  exports: [EmployeeShiftService],
})
export class EmployeeShiftsModule {}
