/**
 * Temporary translation-job cache cleanup.
 *
 * Each translation job writes a config.toml containing the provider API key
 * (or OAuth proxy settings) into `$TMPDIR/aidea-translate/jobs/<jobId>/`. That
 * directory must not outlive the job, so this module is used both by the
 * user-facing "clear cache" action and by plugin startup/shutdown sweeps.
 */

const ACTIVE_JOB_LOCK_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function isAbsolutePath(path: string): boolean {
  return (
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith("\\\\") ||
    path.startsWith("/")
  );
}

function resolveChildPath(parent: string, child: string): string {
  return isAbsolutePath(child) ? child : PathUtils.join(parent, child);
}

/**
 * A job directory whose `running.lock` is missing or expired is considered
 * stale. A malformed lock counts as active to avoid deleting a job that may
 * still be running.
 */
async function isActiveJobDirectory(jobDir: string): Promise<boolean> {
  const lockPath = PathUtils.join(jobDir, "running.lock");
  try {
    if (!(await IOUtils.exists(lockPath))) return false;
    const text = await IOUtils.readUTF8(lockPath);
    const data = JSON.parse(text) as { startedAt?: unknown };
    const startedAt = typeof data.startedAt === "number" ? data.startedAt : 0;
    if (!Number.isFinite(startedAt) || startedAt <= 0) return true;
    return Date.now() - startedAt < ACTIVE_JOB_LOCK_MAX_AGE_MS;
  } catch {
    return true;
  }
}

/**
 * Remove stale `$TMPDIR/aidea-translate` entries and every job directory that
 * is not currently running. Running jobs are skipped (counted separately).
 */
export async function cleanupTranslateTempCache(): Promise<{
  removed: number;
  skippedRunning: number;
}> {
  const tempDir = String(PathUtils.tempDir || "").trim();
  if (!tempDir) return { removed: 0, skippedRunning: 0 };

  const cacheDir = PathUtils.join(tempDir, "aidea-translate");
  const legacyEntries = [
    "progress.json",
    "progress.json.tmp",
    "config.toml",
    "task.json",
    "bridge.log",
  ];

  let removed = 0;
  let skippedRunning = 0;
  for (const entry of legacyEntries) {
    try {
      await IOUtils.remove(PathUtils.join(cacheDir, entry), {
        recursive: true,
      });
      removed += 1;
    } catch {
      /* file may not exist */
    }
  }

  const jobsDir = PathUtils.join(cacheDir, "jobs");
  try {
    if (!(await IOUtils.exists(jobsDir))) return { removed, skippedRunning };
    const children = (await (IOUtils as any).getChildren(jobsDir)) as string[];
    for (const child of children) {
      const jobPath = resolveChildPath(jobsDir, String(child));
      if (await isActiveJobDirectory(jobPath)) {
        skippedRunning += 1;
        continue;
      }
      try {
        await IOUtils.remove(jobPath, { recursive: true });
        removed += 1;
      } catch {
        /* ignore per-job cleanup failure */
      }
    }
  } catch {
    /* ignore cleanup failure */
  }

  return { removed, skippedRunning };
}
