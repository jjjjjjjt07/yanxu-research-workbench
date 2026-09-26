'use client';
import type { ReactNode } from 'react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
export function Picker({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value || null}
      onValueChange={(v) => onChange(String(v ?? ''))}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className="picker">
        <SelectValue>
          {options.find((o) => o.value === value)?.label || label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className={wide ? 'modal modal-wide' : 'modal'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description || '修改后保存到当前课题。'}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="section-empty">
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
export function Label({
  title,
  children,
  hint,
}: {
  title: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="form-label">
      <span>{title}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Badge({
  kind = 'pending',
  children,
}: {
  kind?: string;
  children: ReactNode;
}) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}
export const statusNames: Record<string, string> = {
  pending: '待核对',
  confirmed: '已核对',
  unknown: '未找到',
  stale: '待复查',
  queued: '等待处理',
  running: '提取中',
  failed: '失败',
  succeeded: '完成',
  cancelled: '已取消',
  open: '未处理',
  partial: '部分落实',
  review: '待确认',
  done: '已完成',
  pass: '数据支持',
  fail: '数据不符',
  missing: '信息不足',
};
export function downloadFile(
  name: string,
  content: BlobPart,
  type = 'text/plain;charset=utf-8',
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
let sessionReady: Promise<void> | undefined;
let publicGuest = false;
const processing = new Set<string>();
function processCloudQueue(url: string) {
  const match = /^\/api\/projects\/([^/?]+)(?:\/graph)?$/.exec(url);
  if (!publicGuest || !match || processing.has(match[1])) return;
  processing.add(match[1]);
  void fetch(`/api/projects/${match[1]}/process`, { method: 'POST' })
    .catch(() => {})
    .finally(() => processing.delete(match[1]));
}
export async function request<T = unknown>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  sessionReady ??= fetch('/api/session', { method: 'POST' }).then(async response => {
    if (!response.ok) throw new Error('无法建立访客会话，请刷新后重试。');
    publicGuest = ((await response.json()) as {mode:string}).mode === 'guest';
  }).catch(error => { sessionReady = undefined; throw error; });
  await sessionReady;
  const headers = new Headers(options?.headers);
  if (!(options?.body instanceof FormData) && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  const r = await fetch(url, { ...options, headers });
  let data: unknown;
  try {
    data = await r.json();
  } catch {
    throw new Error(`服务暂时不可用（HTTP ${r.status}），请稍后重试。`);
  }
  if (!r.ok)
    throw new Error((data as { error?: string }).error || '请求未完成。');
  processCloudQueue(url);
  return data as T;
}
