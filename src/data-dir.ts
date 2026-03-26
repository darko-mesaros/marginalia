import * as path from "node:path";
import * as os from "node:os";

/**
 * Resolve the base data directory for Marginalia.
 *
 * Priority:
 * 1. MARGINALIA_DATA_DIR env var (absolute or relative to cwd)
 * 2. Platform default: ~/.config/marginalia/ (Linux/macOS) or %APPDATA%/marginalia/ (Windows)
 */
export function resolveDataDir(): string {
  const envDir = process.env.MARGINALIA_DATA_DIR;
  if (envDir) {
    return path.resolve(envDir);
  }
  const platform = process.platform;
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "marginalia");
  }
  return path.join(os.homedir(), ".config", "marginalia");
}
