// Minimal pure-JS directory listing for HarmonyOS ops presets. The dsh fs
// service has no readdir, so this reads the local filesystem directly with
// node:fs/promises; no native addon, no subprocess, nothing else.
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { FsError } from "@deepseek-ai/dsh-fs";

/** Cordis plugin name used by loader diagnostics. */
const name = "tool-list";
/** Services required by the directory-listing tool. */
const inject = ["tools"];
/** Default cap on returned entries per call. */
const DEFAULT_MAX_ENTRIES = 200;

function formatList(value) {
	const lines = [`${value.path} (${value.total} entries${value.truncated ? ", truncated" : ""})`];
	for (const entry of value.entries) {
		const label = entry.type === "directory" ? "[dir]  " : entry.type === "symlink" ? "[link] " : "       ";
		const size = entry.type === "file" && entry.size !== void 0 ? ` ${entry.size} bytes` : "";
		lines.push(`${label}${entry.name}${size}`);
	}
	return lines.join("\n");
}

/** Register the `list_dir` tool on the current (agent-scoped) context. */
function apply(ctx) {
	ctx.tools.register(defineTool({
		name: "list_dir",
		description: "List the entries of a local directory: each entry's name, kind (file/directory/symlink), and byte size for files. Relative paths resolve against the session working directory. Use this to discover directory contents before reading individual files.",
		parameters: {
			path: {
				type: "string",
				description: "Directory to list. Relative paths resolve against the session working directory; defaults to it."
			},
			max_entries: {
				type: "number",
				description: `Maximum entries to return (default ${DEFAULT_MAX_ENTRIES}).`
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: {
						type: "string",
						required: true
					},
					cwd: {
						type: "string",
						required: true
					},
					total: {
						type: "integer",
						required: true
					},
					truncated: {
						type: "boolean",
						required: true
					},
					entries: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								name: {
									type: "string",
									required: true
								},
								type: {
									type: "string",
									required: true,
									enum: ["file", "directory", "symlink", "other"]
								},
								size: {
									type: "number"
								}
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: formatList(value)
			}]
		},
		isConcurrencySafe: () => true,
		presentCall: (args) => ({
			card: "generic",
			title: "List directory",
			kind: "read",
			...args.path === void 0 ? {} : { rawInput: args.path }
		}),
		async execute(args, exec) {
			const cwd = exec.agent?.session.header.cwd ?? process.cwd();
			const requested = args.path ?? cwd;
			const target = isAbsolute(requested) ? requested : resolvePath(cwd, requested);
			let names;
			try {
				names = await readdir(target, { withFileTypes: true });
			} catch (error) {
				throw new FsError(`cannot list directory "${target}": ${error instanceof Error ? error.message : String(error)}`, "FS_NOT_FOUND");
			}
			const cap = Math.max(1, Math.floor(Number(args.max_entries ?? DEFAULT_MAX_ENTRIES)));
			const entries = [];
			for (const entry of names.slice(0, cap)) {
				const type = entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : entry.isFile() ? "file" : "other";
				const row = { name: entry.name, type };
				if (type === "file") {
					try {
						row.size = (await stat(resolvePath(target, entry.name))).size;
					} catch {
						/* unreadable entry size is not fatal */
					}
				}
				entries.push(row);
			}
			return {
				path: target,
				cwd,
				total: names.length,
				truncated: names.length > cap,
				entries
			};
		}
	}));
}

export { apply, inject, name };
