import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns a minimal healthy status without environment details', () => {
    expect(new HealthController().getHealth()).toEqual({ status: 'ok' });
  });
});
