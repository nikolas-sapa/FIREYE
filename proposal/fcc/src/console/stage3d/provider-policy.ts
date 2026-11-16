export function contextAllowed(search: string, env: Record<string, string | undefined>): boolean {
  const q = new URLSearchParams(search);
  const configured = [env.VITE_CESIUM_ION_TOKEN, env.VITE_GOOGLE_MAPS_KEY].some(value => !!value?.trim());
  return q.get('context') !== '0' && (q.get('context') === '1' || (configured && q.get('tokens') !== '0'));
}
