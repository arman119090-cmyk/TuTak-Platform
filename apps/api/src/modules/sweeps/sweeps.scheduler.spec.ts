import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { Queue } from 'bullmq';
import { SWEEPS } from './sweeps.jobs';
import { SWEEP_JOB_OPTS, SweepsScheduler } from './sweeps.scheduler';

/**
 * Every scheduled sweep must carry a retry policy.
 *
 * On 19.09.2026 a 70-second database restart made two sweeps "fail
 * permanently after 0 attempt(s)": the schedule was registered with no job
 * options, so BullMQ's default of zero attempts applied and the first throw
 * was final. This pins the fix — the options go on the schedule itself, which
 * is the only place a job produced by a scheduler gets them from.
 */
describe('SweepsScheduler', () => {
  function build() {
    const queue = {
      upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
      getJobSchedulers: jest.fn().mockResolvedValue([]),
      removeJobScheduler: jest.fn().mockResolvedValue(undefined),
    };
    const config = { get: jest.fn().mockReturnValue(true) };
    const scheduler = new SweepsScheduler(
      queue as unknown as Queue,
      config as unknown as ConfigService<AppConfig, true>,
    );
    return { queue, scheduler };
  }

  it('registers every sweep with retries and exponential backoff', async () => {
    const { queue, scheduler } = build();
    await scheduler.sync();

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(SWEEPS.length);
    for (const sweep of SWEEPS) {
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(sweep.name, sweep.repeat, {
        name: sweep.name,
        opts: expect.objectContaining({
          attempts: expect.any(Number),
          backoff: expect.objectContaining({ type: 'exponential' }),
        }),
      });
    }
  });

  it('retries more than once, and for longer than a database restart', () => {
    // Five tries from a five-second base: 5 + 10 + 20 + 40 s of waiting
    // before the fifth, about 75 s in total, which covers the 70 s outage
    // that produced the incident with room to spare.
    expect(SWEEP_JOB_OPTS.attempts).toBeGreaterThanOrEqual(3);
    let waited = 0;
    for (let attempt = 1; attempt < SWEEP_JOB_OPTS.attempts; attempt += 1) {
      waited += SWEEP_JOB_OPTS.backoff.delay * 2 ** (attempt - 1);
    }
    expect(waited).toBeGreaterThan(70_000);
  });

  it('removes a schedule the code no longer defines and keeps the rest', async () => {
    const { queue, scheduler } = build();
    const kept = SWEEPS[0]?.name ?? 'sweep.kept';
    queue.getJobSchedulers.mockResolvedValue([{ key: kept }, { key: 'sweep.renamed.away' }]);
    await scheduler.sync();
    expect(queue.removeJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith('sweep.renamed.away');
  });
});
