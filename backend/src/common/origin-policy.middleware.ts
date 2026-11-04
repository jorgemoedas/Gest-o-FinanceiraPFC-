import type { NextFunction, Request, Response } from 'express';

export function createOriginPolicy(allowedOrigins: string | readonly string[]) {
  const origins: readonly string[] = typeof allowedOrigins === 'string' ? allowedOrigins.split(',') : allowedOrigins;
  const allowed = new Set(origins.map((origin) => origin.trim()).filter(Boolean));

  return (request: Request, response: Response, next: NextFunction): void => {
    const origin = request.headers.origin;
    if (origin !== undefined && !allowed.has(origin)) {
      response.status(403).json({ statusCode: 403, message: 'Origem não permitida' });
      return;
    }
    next();
  };
}
