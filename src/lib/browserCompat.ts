// Browser capability detection

export const supportsFileSystemAccess = (): boolean => {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
};

export const supportsWebGPU = async (): Promise<boolean> => {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
  try {
    const adapter = await (navigator as Navigator & { gpu: { requestAdapter: () => Promise<unknown> } }).gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
};

export const supportsSharedArrayBuffer = (): boolean => {
  return typeof SharedArrayBuffer !== 'undefined';
};

export const getBrowserName = (): string => {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari')) return 'Safari';
  return 'Unknown';
};
