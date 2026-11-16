export function skipCivilianBoot(search: string, width: number, view: string): boolean {
  const boot = new URLSearchParams(search).get('boot');
  if (boot === '1') return false;
  return boot === '0' || (view === 'civilian' && width < 768);
}
