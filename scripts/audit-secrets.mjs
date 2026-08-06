import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const IGNORED_ENTRY_NAMES = new Set([
  ".git",
  ".agents",
  ".codex",
  ".planning",
  "node_modules",
  "out",
  "dist",
  "release",
  "artifacts"
]);
const BINARY_EXTENSIONS = new Set([
  ".gif", ".icns", ".ico", ".jpeg", ".jpg", ".pdf", ".png", ".webp", ".zip"
]);
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

const SECRET_PATTERNS = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["Anthropic token", /sk-ant-[A-Za-z0-9_-]{16,}/g],
  ["OpenAI-style token", /sk-[A-Za-z0-9_-]{20,}/g],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{20,}/g],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{16,}/g],
  ["AWS access key", /AKIA[0-9A-Z]{16}/g],
  ["JWT", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  [
    "hard-coded secret assignment",
    /(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'`][^"'`\r\n]{12,}["'`]/gi
  ],
  ["personal home path", /\/(?:home|Users)\/(?!runner(?:\/|$))[^/\s"'`]+\//g]
];

const SENSITIVE_FILE_NAMES = [
  /^\.env(?:\.|$)/i,
  /^(?:credentials?|auth|secrets?)(?:\.|$)/i,
  /\.(?:pem|key|p12|pfx)$/i
];

export async function collectRepositoryIssues(root = PROJECT_ROOT) {
  const issues = [];
  const files = await walk(root);

  for (const file of files) {
    const projectPath = relative(root, file).replaceAll("\\", "/");
    const baseName = projectPath.split("/").at(-1) ?? projectPath;

    for (const rule of SENSITIVE_FILE_NAMES) {
      if (rule.test(baseName) && baseName !== ".env.example") {
        issues.push({ path: projectPath, rule: "sensitive filename" });
      }
      rule.lastIndex = 0;
    }

    if (BINARY_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > MAX_TEXT_FILE_BYTES) continue;

    const content = await readFile(file, "utf8");
    for (const [name, pattern] of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) issues.push({ path: projectPath, rule: name });
    }
  }

  return issues;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    // In a normal clone .git is a directory; in a Git worktree it is a file
    // containing an absolute gitdir path. Both forms are repository metadata,
    // not publishable project content, so skip the entry before inspecting type.
    if (IGNORED_ENTRY_NAMES.has(entry.name)) continue;

    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }

  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = await collectRepositoryIssues();
  if (issues.length > 0) {
    console.error("Repository secret audit failed:");
    for (const issue of issues) console.error(`- ${issue.path}: ${issue.rule}`);
    process.exitCode = 1;
  } else {
    console.log("Repository secret audit passed: no high-confidence secrets or private paths found.");
  }
}
