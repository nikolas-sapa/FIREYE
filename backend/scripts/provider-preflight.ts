import { createProviderActivation } from '../setup/activation-status.ts';

// No config/credential discovery or account calls at import/default status.
export async function runPreflightCli(args: readonly string[], env: unknown, write: (line: string) => void): Promise<number> {
  if (args.length === 0 || args.length === 1 && args[0] === '--status') {
    write(JSON.stringify(createProviderActivation(env).status()));
    return 0;
  }
  if (args.length !== 2 || args[0] !== '--check' || args[1] !== 'gemini' && args[1] !== 'treg') {
    write(JSON.stringify({ ok: false, code: 'INVALID_INPUT', genuine_calls: 0, read_only_attempts: 0 }));
    return 2;
  }
  const report = await createProviderActivation(env).check(args[1], { enabled: true });
  write(JSON.stringify(report));
  const result = report.providers.find(row => row.provider === args[1])?.auth_status;
  return result === 'verified' || result === 'account-read-succeeded' ? 0 : 1;
}

if (import.meta.main) process.exitCode = await runPreflightCli(process.argv.slice(2), process.env, line => process.stdout.write(`${line}\n`));
