import * as vscode from "vscode";
import * as path from "path";
import { promises as fs } from "fs";
import { execFile } from "child_process";
import type { ExecFileException } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

let outputChannel: vscode.OutputChannel | undefined;

interface PresetCommand {
  command: string;
  args?: string[];
  cwd?: string;
}

interface WorktreePreset {
  name: string;
  description?: string;
  envTargets?: string[];
  postCommands?: PresetCommand[];
  usePackageManagerInstall?: boolean;
}

interface NormalizedPreset {
  name: string;
  description?: string;
  envTargets: string[];
  postCommands: PresetCommand[];
  usePackageManagerInstall: boolean;
}

type PackageManagerId = "bun" | "npm" | "yarn" | "pnpm" | "skip";

interface PackageManagerChoice {
  id: PackageManagerId;
  label: string;
  detail: string;
  installCommand?: PresetCommand;
}

const packageManagerOptions: PackageManagerChoice[] = [
  {
    id: "bun",
    label: "Bun",
    detail: "Run bun install in the worktree root.",
    installCommand: { command: "bun", args: ["install"] },
  },
  {
    id: "npm",
    label: "npm",
    detail: "Run npm install in the worktree root.",
    installCommand: { command: "npm", args: ["install"] },
  },
  {
    id: "yarn",
    label: "Yarn",
    detail: "Run yarn install in the worktree root.",
    installCommand: { command: "yarn", args: ["install"] },
  },
  {
    id: "pnpm",
    label: "pnpm",
    detail: "Run pnpm install in the worktree root.",
    installCommand: { command: "pnpm", args: ["install"] },
  },
  {
    id: "skip",
    label: "Skip install",
    detail: "Do not run a package manager install command.",
  },
];

const builtInPresets: NormalizedPreset[] = [
  {
    name: "default",
    description:
      "Copy .env files to the worktree and run the selected package manager install in the root.",
    envTargets: [],
    postCommands: [],
    usePackageManagerInstall: true,
  },
  {
    name: "remetricate",
    description:
      "Default actions plus copy environment files to packages/workflow-platform.",
    envTargets: ["packages/workflow-platform"],
    postCommands: [],
    usePackageManagerInstall: true,
  },
];

export function activate(context: vscode.ExtensionContext) {
  const channel = getOutputChannel();
  context.subscriptions.push(channel);

  const disposable = vscode.commands.registerCommand(
    "worktree-helper.createWorktree",
    async () => {
      channel.clear();
      log("Starting worktree creation…");

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(
          "Open a folder in VS Code before creating a worktree."
        );
        log("Action cancelled: no workspace is open.");
        return;
      }

      const workspaceRoot = workspaceFolder.uri.fsPath;

      const folderName = await promptFolderName();
      if (!folderName) {
        log("Action cancelled: no worktree folder name provided.");
        return;
      }

      const branchName = await promptBranchName();
      if (!branchName) {
        log("Action cancelled: no branch name provided.");
        return;
      }

      const packageManager = await resolvePackageManagerChoice();
      if (!packageManager) {
        log("Action cancelled: no package manager selected.");
        return;
      }

      if (packageManager.installCommand) {
        log(`Selected package manager: ${packageManager.label}`);
      } else {
        log("Package manager install command will be skipped.");
      }

      const presets = getAvailablePresets();
      const preset = await promptPreset(presets);
      if (!preset) {
        log("Action cancelled: no preset selected.");
        return;
      }

      const postCommands = buildPostCommands(preset, packageManager);
      if (
        preset.usePackageManagerInstall &&
        packageManager.id === "skip" &&
        postCommands.length === preset.postCommands.length
      ) {
        log(
          "Preset requested an install command, but the selection was to skip it."
        );
      }

      const worktreeBase = path.join(workspaceRoot, "worktree");
      const worktreePath = path.join(worktreeBase, folderName);

      try {
        await ensureWorktreeIgnored(workspaceRoot);

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Creating new worktree…",
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "Preparing folders…" });
            await fs.mkdir(worktreeBase, { recursive: true });
            await ensureDirectoryIsFree(worktreePath);

            progress.report({ message: "Running git worktree…" });
            await createWorktree(workspaceRoot, worktreePath, branchName);

            progress.report({ message: "Copying environment files…" });
            await copyEnvFiles(workspaceRoot, worktreePath, preset.envTargets);

            if (postCommands.length > 0) {
              await runPostCommands(
                workspaceRoot,
                worktreePath,
                postCommands,
                progress
              );
            } else {
              log("No post-creation commands configured for this preset.");
            }
          }
        );

        log(`Worktree successfully created at ${worktreePath}`);
        const choice = await vscode.window.showInformationMessage(
          `Worktree created at ${worktreePath}`,
          "Open Worktree",
          "Reveal in File Explorer",
          "Show Logs"
        );

        if (choice === "Open Worktree") {
          await vscode.commands.executeCommand(
            "vscode.openFolder",
            vscode.Uri.file(worktreePath),
            true
          );
        } else if (choice === "Reveal in File Explorer") {
          await vscode.commands.executeCommand(
            "revealFileInOS",
            vscode.Uri.file(worktreePath)
          );
        } else if (choice === "Show Logs") {
          channel.show(true);
        }
      } catch (error) {
        showError(error);
        channel.show(true);
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {
  // noop
}

async function promptFolderName(): Promise<string | undefined> {
  const folderName = await vscode.window.showInputBox({
    title: "Worktree folder name",
    prompt: "The folder will be created inside worktree/.",
    ignoreFocusOut: true,
    validateInput: (value: string) =>
      !value.trim() ? "Folder name cannot be empty." : undefined,
  });

  return folderName?.trim();
}

async function promptBranchName(): Promise<string | undefined> {
  const branchName = await vscode.window.showInputBox({
    title: "Branch name",
    prompt: "Provide the name of the branch to be created.",
    ignoreFocusOut: true,
    validateInput: (value: string) =>
      !value.trim() ? "Branch name cannot be empty." : undefined,
  });

  return branchName?.trim();
}

async function resolvePackageManagerChoice(): Promise<
  PackageManagerChoice | undefined
> {
  const config = vscode.workspace.getConfiguration("worktree-helper");
  const configuredId = coercePackageManagerId(config.get("packageManager"));
  const defaultOption = findPackageManagerOption(configuredId);
  const promptEachTime = config.get<boolean>("promptPackageManager");

  if (promptEachTime === false) {
    return defaultOption;
  }

  const items: Array<vscode.QuickPickItem & { option: PackageManagerChoice }> =
    packageManagerOptions.map((option) => ({
      label: option.label,
      description: option.installCommand
        ? formatCommand(
            option.installCommand.command,
            option.installCommand.args ?? []
          )
        : undefined,
      detail: option.detail,
      picked: option.id === defaultOption.id,
      option,
    }));

  const picked = await vscode.window.showQuickPick(items, {
    title: "Select package manager",
    placeHolder:
      "Choose which package manager install command should run after creating the worktree",
    ignoreFocusOut: true,
  });

  return picked?.option;
}

async function ensureWorktreeIgnored(workspaceRoot: string): Promise<void> {
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  const entryVariants = new Set([
    "worktree",
    "worktree/",
    "/worktree",
    "/worktree/",
    "./worktree/",
  ]);
  const desiredEntry = "worktree/";

  try {
    const raw = await fs.readFile(gitignorePath, "utf8");
    const lines = raw.split(/\r?\n/).map((line) => line.trim());
    if (lines.some((line) => entryVariants.has(line))) {
      log(".gitignore already contains the worktree/ entry.");
      return;
    }

    const needsTrailingNewLine = raw.length > 0 && !raw.endsWith("\n");
    const updated = `${raw}${
      needsTrailingNewLine ? "\n" : ""
    }${desiredEntry}\n`;
    await fs.writeFile(gitignorePath, updated, "utf8");
    log("Added worktree/ to .gitignore.");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      await fs.writeFile(gitignorePath, `${desiredEntry}\n`, "utf8");
      log("Created .gitignore with worktree/ entry.");
      return;
    }

    throw error;
  }
}

async function ensureDirectoryIsFree(directory: string): Promise<void> {
  if (await pathExists(directory)) {
    throw new Error(`Folder ${directory} already exists.`);
  }
}

async function createWorktree(
  workspaceRoot: string,
  worktreePath: string,
  branchName: string
): Promise<void> {
  log(`Running git worktree add ${worktreePath} -b ${branchName}`);
  try {
    await execFileAsync(
      "git",
      ["worktree", "add", worktreePath, "-b", branchName],
      {
        cwd: workspaceRoot,
      }
    );
  } catch (error) {
    const stderr = isExecFileError(error)
      ? error.stderr?.toString()
      : undefined;
    if (stderr && stderr.trim().length > 0) {
      throw new Error(stderr.trim());
    }
    throw error;
  }
}

async function copyEnvFiles(
  workspaceRoot: string,
  worktreePath: string,
  additionalTargets: string[]
): Promise<void> {
  const envFiles = await collectEnvFiles(workspaceRoot, [".env", ".env.local"]);
  if (envFiles.length === 0) {
    log("⚠️ No .env files found in the workspace root.");
    return;
  }

  for (const file of envFiles) {
    const destination = path.join(worktreePath, file.name);
    await fs.copyFile(file.path, destination);
    log(
      `Copied ${file.name} to ${
        path.relative(workspaceRoot, destination) || "."
      }`
    );
  }

  for (const target of additionalTargets) {
    const destinationDir = path.join(worktreePath, target);
    if (!(await pathExists(destinationDir))) {
      log(`⚠️ Additional path not found inside worktree: ${target}`);
      continue;
    }

    for (const file of envFiles) {
      const destination = path.join(destinationDir, file.name);
      await fs.copyFile(file.path, destination);
      log(
        `Copied ${file.name} to ${path.relative(workspaceRoot, destination)}`
      );
    }
  }
}

async function runPostCommands(
  workspaceRoot: string,
  worktreePath: string,
  commands: PresetCommand[],
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<void> {
  for (const command of commands) {
    const args = command.args ?? [];
    const cwd = resolveCommandCwd(workspaceRoot, worktreePath, command.cwd);
    const label = formatCommand(command.command, args);

    progress.report({ message: `Running ${label}…` });
    log(`$ ${label} (cwd: ${cwd})`);

    try {
      const { stdout, stderr } = await execFileAsync(command.command, args, {
        cwd,
      });
      if (stdout && stdout.trim()) {
        log(stdout.trim());
      }
      if (stderr && stderr.trim()) {
        log(stderr.trim());
      }
    } catch (error) {
      const stderr = isExecFileError(error)
        ? error.stderr?.toString()
        : undefined;
      throw new Error(stderr?.trim() || `Failed to run ${label}.`);
    }
  }
}

function buildPostCommands(
  preset: NormalizedPreset,
  packageManager: PackageManagerChoice
): PresetCommand[] {
  const commands: PresetCommand[] = [];

  if (preset.usePackageManagerInstall && packageManager.installCommand) {
    commands.push({
      command: packageManager.installCommand.command,
      args: packageManager.installCommand.args
        ? [...packageManager.installCommand.args]
        : undefined,
    });
  }

  if (preset.postCommands.length > 0) {
    commands.push(
      ...preset.postCommands.map((command) => ({
        command: command.command,
        args: command.args ? [...command.args] : undefined,
        cwd: command.cwd,
      }))
    );
  }

  return commands;
}

function getAvailablePresets(): NormalizedPreset[] {
  const config = vscode.workspace.getConfiguration("worktree-helper");
  const customPresets = config.get<WorktreePreset[]>("presets") ?? [];

  const presets = new Map<string, NormalizedPreset>();
  for (const preset of builtInPresets) {
    presets.set(preset.name, {
      name: preset.name,
      description: preset.description,
      envTargets: [...preset.envTargets],
      postCommands: preset.postCommands.map((command) => ({
        command: command.command,
        args: command.args ? [...command.args] : undefined,
        cwd: command.cwd,
      })),
      usePackageManagerInstall: preset.usePackageManagerInstall,
    });
  }

  for (const preset of customPresets) {
    if (!preset || typeof preset.name !== "string") {
      continue;
    }

    const normalized = normalizePreset(preset);
    if (!normalized) {
      continue;
    }

    presets.set(normalized.name, normalized);
  }

  return Array.from(presets.values());
}

function coercePackageManagerId(value: unknown): PackageManagerId | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return packageManagerOptions.some((option) => option.id === value)
    ? (value as PackageManagerId)
    : undefined;
}

function findPackageManagerOption(id?: PackageManagerId): PackageManagerChoice {
  if (id) {
    const match = packageManagerOptions.find((option) => option.id === id);
    if (match) {
      return match;
    }
  }

  return packageManagerOptions[0];
}

function normalizePreset(preset: WorktreePreset): NormalizedPreset | undefined {
  const name = preset.name?.trim();
  if (!name) {
    return undefined;
  }

  const envTargets = Array.isArray(preset.envTargets)
    ? Array.from(
        new Set(
          preset.envTargets
            .map((target) => target?.trim())
            .filter(
              (target): target is string =>
                Boolean(target) && target !== "." && target !== "./"
            )
        )
      )
    : [];

  const postCommands = Array.isArray(preset.postCommands)
    ? preset.postCommands
        .filter((command): command is PresetCommand =>
          Boolean(
            command &&
              typeof command.command === "string" &&
              command.command.trim().length > 0
          )
        )
        .map((command) => ({
          command: command.command.trim(),
          args: Array.isArray(command.args)
            ? command.args.map((arg) => String(arg))
            : undefined,
          cwd: typeof command.cwd === "string" ? command.cwd : undefined,
        }))
    : [];

  return {
    name,
    description: preset.description,
    envTargets,
    postCommands,
    usePackageManagerInstall: preset.usePackageManagerInstall === true,
  };
}

async function promptPreset(
  presets: NormalizedPreset[]
): Promise<NormalizedPreset | undefined> {
  if (presets.length === 1) {
    return presets[0];
  }

  const items = presets.map((preset) => ({
    label: preset.name,
    description: preset.description,
    preset,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: "Choose a configuration preset",
    placeHolder:
      "Select the preset that defines additional directories and post commands",
    ignoreFocusOut: true,
  });

  return picked?.preset;
}

async function collectEnvFiles(
  workspaceRoot: string,
  fileNames: string[]
): Promise<Array<{ name: string; path: string }>> {
  const existing: Array<{ name: string; path: string }> = [];
  for (const name of fileNames) {
    const filePath = path.join(workspaceRoot, name);
    if (await pathExists(filePath)) {
      existing.push({ name, path: filePath });
    }
  }
  return existing;
}

function resolveCommandCwd(
  workspaceRoot: string,
  worktreePath: string,
  cwd?: string
): string {
  if (!cwd || !cwd.trim()) {
    return worktreePath;
  }

  const replaced = cwd
    .replace(/\$\{workspaceRoot\}/g, workspaceRoot)
    .replace(/\$\{worktreePath\}/g, worktreePath);

  return path.isAbsolute(replaced)
    ? replaced
    : path.join(worktreePath, replaced);
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ").trim();
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  log(`Error: ${message}`);
  vscode.window.showErrorMessage(`Failed to create worktree: ${message}`);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function isExecFileError(
  error: unknown
): error is ExecFileException & { stderr?: string | Buffer } {
  return typeof error === "object" && !!error && "stderr" in error;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Worktree Helper");
  }
  return outputChannel;
}

function log(message: string): void {
  getOutputChannel().appendLine(message);
}
