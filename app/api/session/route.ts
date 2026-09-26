import { bindings, mutationGuard, json, failure } from '@/lib/server';
import { createGuestSession, readGuestSession, sessionCookie, guestCookie } from '@/lib/guest-session';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    mutationGuard(req);
    const env = bindings();
    if (env.PUBLIC_ACCESS !== '1') return json({ mode: 'private' });
    const secret = env.GUEST_SESSION_SECRET ?? '';
    const existing = await readGuestSession(sessionCookie(req), secret);
    const response = json({ mode: 'guest', notice: '免登录访客空间；资料随本浏览器会话保存，清除Cookie将失去访问权限。云端任务请保持页面打开，刷新后可继续。' });
    if (!existing) response.headers.set('Set-Cookie', `${guestCookie}=${await createGuestSession(secret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`);
    return response;
  } catch(e) { return failure(e); }
}
