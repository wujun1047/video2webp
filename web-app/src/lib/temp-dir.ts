import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

export type JobPaths = {
  id: string;
  root: string;
  input: string;
  framesDir: string;
  keyedDir: string;
  output: string;
};

export async function createJobPaths(): Promise<JobPaths> {
  const root = await mkdtemp(join(tmpdir(), "video2webp-"));
  const id = root.split("video2webp-").at(-1) ?? randomUUID();

  return {
    id,
    root,
    input: join(root, "input-video"),
    framesDir: join(root, "frames"),
    keyedDir: join(root, "keyed"),
    output: join(root, "output.webp"),
  };
}

export async function cleanupJob(paths: Pick<JobPaths, "root">) {
  await rm(paths.root, { recursive: true, force: true });
}
