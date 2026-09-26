import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // vinext also inspects multipart API uploads in its progressive action path.
  // 允许「单篇 60 MB 原始文件 + 解析块 + 表单开销」通过；
  // 单个 API 路由仍按 lib/limits.ts 做更严格的文件/请求体校验。
  experimental: { serverActions: { bodySizeLimit: '72mb' } },
};

export default nextConfig;
