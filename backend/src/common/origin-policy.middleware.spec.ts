import type { NextFunction, Request, Response } from 'express';
import { createOriginPolicy } from './origin-policy.middleware';

describe('createOriginPolicy', () => {
  function invoke(origin?: string) {
    const next = jest.fn() as unknown as NextFunction;
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const response = { status, json } as unknown as Response;
    const request = { headers: origin !== undefined ? { origin } : {} } as Request;

    createOriginPolicy('http://localhost:3000,https://app.example.com')(request, response, next);
    return { next, status, json };
  }

  it('recusa explicitamente uma origem não permitida antes de CORS', () => {
    const { next, status, json } = invoke('https://origem-estranha.invalid');

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ statusCode: 403, message: 'Origem não permitida' });
    expect(next).not.toHaveBeenCalled();
  });

  it('recusa cabeçalho Origin presente, mas vazio', () => {
    const { next, status } = invoke('');

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('permite qualquer origem configurada', () => {
    const { next, status } = invoke('https://app.example.com');

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('preserva chamadas server-side e navegação sem cabeçalho Origin', () => {
    const { next, status, json } = invoke();

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });
});
