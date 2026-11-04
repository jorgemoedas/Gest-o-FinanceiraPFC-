import { createJsonLogger } from './logger';

describe('createJsonLogger', () => {
  it('writes one JSON line and removes forbidden keys recursively', () => {
    const write = jest.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);

    createJsonLogger().log({
      message: 'request',
      requestId: 'req-12345678',
      nested: {
        safe: 'kept',
        authorization: 'Bearer hidden',
        token: 'hidden',
        deeper: { password: 'hidden', value: 42 }
      }
    });

    expect(write).toHaveBeenCalledTimes(1);
    const line = String(write.mock.calls[0]?.[0]);
    expect(line.endsWith('\n')).toBe(true);
    const event = JSON.parse(line) as Record<string, unknown>;
    expect(event.level).toBe('log');
    expect(event.message).toBe('request');
    expect(line).not.toContain('authorization');
    expect(line).not.toContain('Bearer hidden');
    expect(line).not.toContain('password');
    expect(line).not.toContain('token');

    write.mockRestore();
  });
});
