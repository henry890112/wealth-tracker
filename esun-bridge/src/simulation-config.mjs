import fs from 'node:fs';
import path from 'node:path';

const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

export function getSimulationConfigPath() {
  const configPath = process.env.ESUN_CONFIG_PATH;
  if (!configPath || !fs.existsSync(configPath)) {
    throw new Error('找不到 ESUN_CONFIG_PATH 指定的模擬設定檔。');
  }
  // Guard against accidentally sending the test command with a production config.
  const config = fs.readFileSync(configPath, 'utf8');
  if (!/^\s*Environment\s*=\s*SIMULATION\s*$/im.test(config)) {
    throw new Error('設定檔不是 SIMULATION 環境，已停止執行。');
  }
  return configPath;
}
