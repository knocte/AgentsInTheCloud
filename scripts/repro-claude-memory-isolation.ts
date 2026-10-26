// Shows whether Claude Code's per-project data (~/.claude/projects/-work, holding transcripts and
// auto-memory) leaks between two workspaces, using the real workspace home mounts and real containers.
// Needs Docker on the same filesystem as this process. Leaves nothing behind.
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "claude-memory-isolation-"));
process.env.ATELIER_DATA_DIR = directory;
process.env.ATELIER_DOCKER_HOST_DATA_DIR = directory;
// A seeded shared home, so the real code skips pulling the workspace image.
await mkdir(join(directory, "home", ".claude"), { recursive: true });
const { workspaceHomeMounts } = await import("../packages/workspace/src/home.ts");

async function run(workspaceId: string, script: string): Promise<string> {
  const mounts = (await workspaceHomeMounts(workspaceId)).flatMap(mount => ["--mount", `type=bind,source=${mount.source},target=${mount.target}`]);
  const child = Bun.spawn(["docker", "run", "--rm", "--user", `${process.getuid!()}:${process.getgid!()}`, ...mounts, "alpine", "sh", "-c", script], { stdout: "pipe", stderr: "inherit" });
  const output = await new Response(child.stdout).text();
  if (await child.exited !== 0) throw new Error(`docker run failed for ${workspaceId}`);
  return output.trim();
}

try {
  const memory = "/home/agents-in-the-cloud/.claude/projects/-work/memory/MEMORY.md";
  await run("project-a-workspace", `mkdir -p $(dirname ${memory}) && echo 'Project A: deploy with fly.io' > ${memory}`);
  const seen = await run("project-b-workspace", `cat ${memory} 2>/dev/null || echo '(no memory)'`);
  console.log(`Workspace B sees Claude's memory as: ${seen}`);
  console.log(seen.includes("Project A") ? "LEAK: workspace B reads workspace A's Claude memory" : "ISOLATED: workspace B has its own Claude memory");
} finally {
  await rm(directory, { recursive: true, force: true });
}
