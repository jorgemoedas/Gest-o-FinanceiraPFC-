import { NextRequest, NextResponse } from 'next/server';

const ACCESS = 'gft_access_token';
const REFRESH = 'gft_refresh_token';
const TTL_REFRESH_SECONDS = 30 * 24 * 60 * 60;
const activeRefreshes = new Map<string, Promise<{ accessToken: string; refreshToken: string; expiresInSeconds: number }>>();

function tokenExpired(token?: string): boolean {
  if (!token) return true;
  try {
    const payload = token.split('.')[1];
    if (!payload) return false;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number };
    return typeof decoded.exp === 'number' && decoded.exp <= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!path.startsWith('/api/') || ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout'].includes(path)) return NextResponse.next();
  const access = request.cookies.get(ACCESS)?.value;
  const refresh = request.cookies.get(REFRESH)?.value;
  if (!refresh || !tokenExpired(access)) return NextResponse.next();

  const base = process.env.AUTH_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (!base) return NextResponse.next();
  let response: NextResponse;
  try {
    let pending = activeRefreshes.get(refresh);
    if (!pending) {
      pending = (async () => {
        const upstream = await fetch(`${base}/auth/refresh`, {
          method: 'POST', cache: 'no-store',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refresh }),
          signal: AbortSignal.timeout(15_000)
        });
        const payload = await upstream.json() as { accessToken?: string; refreshToken?: string; expiresInSeconds?: number };
        if (!upstream.ok || !payload.accessToken || !payload.refreshToken) throw new Error('refresh recusado');
        return { accessToken: payload.accessToken, refreshToken: payload.refreshToken, expiresInSeconds: Number(payload.expiresInSeconds) || 900 };
      })();
      activeRefreshes.set(refresh, pending);
    }
    let payload: { accessToken: string; refreshToken: string; expiresInSeconds: number };
    try { payload = await pending; } finally { activeRefreshes.delete(refresh); }
    request.cookies.set(ACCESS, payload.accessToken);
    request.cookies.set(REFRESH, payload.refreshToken);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('cookie', request.cookies.toString());
    response = NextResponse.next({ request: { headers: requestHeaders } });
    const accessAge = payload.expiresInSeconds;
    const secure = process.env.AUTH_COOKIE_SECURE !== 'false';
    response.cookies.set(ACCESS, payload.accessToken, { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', path: '/', maxAge: accessAge });
    response.cookies.set(REFRESH, payload.refreshToken, { httpOnly: true, secure: true, sameSite: 'none', path: '/', maxAge: TTL_REFRESH_SECONDS });
    return response;
  } catch {
    request.cookies.delete(ACCESS);
    request.cookies.delete(REFRESH);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('cookie', request.cookies.toString());
    response = NextResponse.next({ request: { headers: requestHeaders } });
    const secure = process.env.AUTH_COOKIE_SECURE !== 'false';
    response.cookies.set(ACCESS, '', { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', path: '/', maxAge: 0 });
    response.cookies.set(REFRESH, '', { httpOnly: true, secure: true, sameSite: 'none', path: '/', maxAge: 0 });
    return response;
  }
}

export const config = { matcher: ['/api/:path*'] };
