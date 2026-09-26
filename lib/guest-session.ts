const encoder = new TextEncoder();
export const guestCookie = 'research_guest';
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
async function key(secret: string) {
  if (secret.length < 32) throw new Error('访客会话密钥未配置。');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign','verify']);
}
export async function createGuestSession(secret: string) {
  const payload = `${crypto.randomUUID()}.${Math.floor(Date.now()/1000) + 30*86400}`;
  return `${payload}.${hex(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(payload)))}`;
}
export async function readGuestSession(token: string, secret: string): Promise<string | null> {
  const match = /^([0-9a-f-]{36})\.(\d{10})\.([0-9a-f]{64})$/.exec(token);
  if (!match || Number(match[2]) <= Date.now()/1000) return null;
  const valid = await crypto.subtle.verify('HMAC', await key(secret), Uint8Array.from(match[3].match(/../g)!, s => parseInt(s,16)), encoder.encode(`${match[1]}.${match[2]}`));
  return valid ? `guest:${match[1]}` : null;
}
export function sessionCookie(req: Request) {
  return (req.headers.get('cookie') ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(guestCookie+'='))?.slice(guestCookie.length+1) ?? '';
}
