// dsh-deveco-bridge: HarmonyOS DevEco toolchain tools for dsh presets.
// Pure JS; drives hvigor/ohpm/hdc through node:child_process (see runner.js).
import { stat } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { runCommand, TOOLS } from "./runner.js";

/** Cordis plugin name used by loader diagnostics. */
const name = "deveco-bridge";
/** Services required by the tools. */
const inject = ["tools"];

const NODE_BIN = `${TOOLS.nodeHome}/bin/node`;
const HVIGOR_JS = `${TOOLS.hvigorHome}/bin/hvigorw.js`;

function formatResult(value) {
  const head =
    `${value.ok ? "OK" : "FAIL"} · exit ${value.exitCode} · ${value.durationMs}ms` +
    `${value.timedOut ? " · TIMED OUT" : ""}` +
    `${value.truncated ? " · (tail " + 200 + " lines)" : ""}`;
  const lines = [head, `cmd: ${value.command}`];
  if (value.output) lines.push("", "```", value.output, "```");
  return lines.join("\n");
}

const resultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ok: { type: "boolean", required: true },
    command: { type: "string", required: true },
    exitCode: { type: "integer", required: true },
    durationMs: { type: "integer", required: true },
    timedOut: { type: "boolean", required: true },
    truncated: { type: "boolean", required: true },
    output: { type: "string", required: true }
  }
};

function renderResult(_args, value) {
  return [{ type: "text", text: formatResult(value) }];
}

async function ensureProjectDir(requested, cwd) {
  const target = isAbsolute(requested) ? requested : resolvePath(cwd, requested);
  const s = await stat(target).catch(() => null);
  if (!s?.isDirectory()) {
    throw new Error(`project directory not found: ${target}`);
  }
  return target;
}

function present(card, title, kind, rawInput) {
  return (args) => ({
    card,
    title,
    kind,
    ...(rawInput && args[rawInput] !== void 0 ? { rawInput: args[rawInput] } : {})
  });
}

/** Assemble a tool result from one or more sequential command steps. */
function assemble(label, steps) {
  const last = steps[steps.length - 1];
  const ok = steps.every((s) => s.exitCode === 0);
  const command = steps.map((s) => s.command).join(" && ");
  const output = steps
    .map((s, i) => (steps.length > 1 ? `$ ${s.command}\n` : "") + s.output)
    .join("\n---\n")
    .trim();
  return {
    ok,
    command: `${label}: ${command}`,
    exitCode: ok ? 0 : last.exitCode,
    durationMs: steps.reduce((a, s) => a + s.durationMs, 0),
    timedOut: steps.some((s) => s.timedOut),
    truncated: steps.some((s) => s.truncated),
    output
  };
}

function apply(ctx) {
  const tools = [];

  tools.push(defineTool({
    name: "dev_environment",
    description: "Probe the local DevEco toolchain: node / hvigor / ohpm / hdc versions and the HarmonyOS SDK. Run this first to learn what is installed before planning a build or deploy.",
    parameters: {},
    output: {
      schema: resultSchema,
      render: renderResult
    },
    isConcurrencySafe: () => true,
    presentCall: present("generic", "Probe DevEco environment", "read"),
    async execute(_args, exec) {
      const cwd = exec.agent?.session.header.cwd ?? process.cwd();
      const probes = [
        { file: NODE_BIN, args: ["--version"], cmd: "node --version" },
        { file: NODE_BIN, args: [HVIGOR_JS, "--version"], cmd: "node hvigorw.js --version" },
        { file: TOOLS.ohpmBin, args: ["--version"], cmd: "ohpm --version" },
        { file: TOOLS.hdcBin, args: ["list", "targets"], cmd: "hdc list targets" }
      ];
      const steps = [];
      for (const p of probes) {
        const r = await runCommand(p.file, p.args, { cwd });
        steps.push({ ...r, command: p.cmd });
      }
      return assemble("dev_environment", steps);
    }
  }));

  tools.push(defineTool({
    name: "dev_install_deps",
    description: "Install a HarmonyOS project's dependencies by running `ohpm install` in the project directory. Run this when a build fails because oh-package dependencies are missing or outdated.",
    parameters: {
      project: {
        type: "string",
        description: "Path to the HarmonyOS project directory (containing oh-package.json5). Relative paths resolve against the session working directory."
      }
    },
    output: {
      schema: resultSchema,
      render: renderResult
    },
    isConcurrencySafe: () => false,
    presentCall: present("generic", "Install ohpm dependencies", "write", "project"),
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd ?? process.cwd();
      const project = await ensureProjectDir(args.project, cwd);
      const r = await runCommand(TOOLS.ohpmBin, ["install"], { cwd: project });
      return { ...r, ok: r.exitCode === 0, command: `ohpm install (in ${project})` };
    }
  }));

  tools.push(defineTool({
    name: "dev_build",
    description: "Build a HarmonyOS project with hvigor. Defaults to assembling the HAP (assembleHap). Use clean to force a full rebuild, mode=release for a signed release package, and installDeps to run `ohpm install` first. Reports the last 200 lines of the build log.",
    parameters: {
      project: {
        type: "string",
        description: "Path to the HarmonyOS project directory (containing build-profile.json5). Relative paths resolve against the session working directory."
      },
      task: {
        type: "string",
        description: "hvigor task to run (default assembleHap)."
      },
      mode: {
        type: "string",
        description: "Build mode: debug or release (maps to -p buildMode). Omit for hvigor default."
      },
      clean: {
        type: "boolean",
        description: "Run `hvigorw clean` before the build task."
      },
      installDeps: {
        type: "boolean",
        description: "Run `ohpm install` before building."
      }
    },
    output: {
      schema: resultSchema,
      render: renderResult
    },
    isConcurrencySafe: () => false,
    presentCall: present("generic", "Build HarmonyOS project", "write", "project"),
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd ?? process.cwd();
      const project = await ensureProjectDir(args.project, cwd);
      const task = args.task ?? "assembleHap";
      const steps = [];
      if (args.installDeps) {
        const inst = await runCommand(TOOLS.ohpmBin, ["install"], { cwd: project });
        steps.push({ ...inst, command: `ohpm install (in ${project})` });
      }
      const hvigorArgs = [
        ...(args.clean ? ["clean"] : []),
        task,
        ...(args.mode ? ["-p", `buildMode=${args.mode}`] : [])
      ];
      const build = await runCommand(NODE_BIN, [HVIGOR_JS, ...hvigorArgs], { cwd: project });
      steps.push({
        ...build,
        command: `node hvigorw.js ${hvigorArgs.join(" ")} (in ${project})`
      });
      return assemble("dev_build", steps);
    }
  }));

  tools.push(defineTool({
    name: "dev_list_devices",
    description: "List connected HarmonyOS devices/emulators by running `hdc list targets`. Each line is a serial usable as the device argument for dev_deploy.",
    parameters: {},
    output: {
      schema: resultSchema,
      render: renderResult
    },
    isConcurrencySafe: () => true,
    presentCall: present("generic", "List connected devices", "read"),
    async execute(_args, _exec) {
      const r = await runCommand(TOOLS.hdcBin, ["list", "targets"], {});
      return { ...r, ok: r.exitCode === 0, command: "hdc list targets" };
    }
  }));

  tools.push(defineTool({
    name: "dev_deploy",
    description: "Install a built HAP onto a connected device and optionally launch its main ability. First device is chosen automatically unless device is given. Pass bundleName (and abilityName, default EntryAbility) to launch after install.",
    parameters: {
      hapPath: {
        type: "string",
        description: "Path to the .hap file to install (absolute, or relative to the session working directory)."
      },
      device: {
        type: "string",
        description: "Target device serial from `hdc list targets`. Defaults to the first connected device."
      },
      bundleName: {
        type: "string",
        description: "Bundle name to launch after install (e.g. com.example.app). Omit to only install."
      },
      abilityName: {
        type: "string",
        description: "Ability to launch (default EntryAbility)."
      }
    },
    output: {
      schema: resultSchema,
      render: renderResult
    },
    isConcurrencySafe: () => false,
    presentCall: present("generic", "Deploy HAP to device", "write", "hapPath"),
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd ?? process.cwd();
      const hap = isAbsolute(args.hapPath) ? args.hapPath : resolvePath(cwd, args.hapPath);
      const s = await stat(hap).catch(() => null);
      if (!s?.isFile()) throw new Error(`hap file not found: ${hap}`);

      const targets = await runCommand(TOOLS.hdcBin, ["list", "targets"], {});
      const lines = (targets.output ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("["));
      const device = args.device ?? lines[0];
      if (!device) {
        throw new Error("no connected device; run dev_list_devices or connect a device via hdc");
      }

      const steps = [{ ...targets, command: "hdc list targets" }];
      const inst = await runCommand(TOOLS.hdcBin, ["-t", device, "install", hap], {});
      steps.push({ ...inst, command: `hdc -t ${device} install ${hap}` });
      if (args.bundleName) {
        const ability = args.abilityName ?? "EntryAbility";
        const start = await runCommand(
          TOOLS.hdcBin,
          ["-t", device, "shell", "aa", "start", "-b", args.bundleName, "-a", ability],
          {}
        );
        steps.push({ ...start, command: `hdc -t ${device} shell aa start -b ${args.bundleName} -a ${ability}` });
      }
      return assemble("dev_deploy", steps);
    }
  }));

  tools.push(defineTool({
    name: "dev_code",
    description:
      "Delegate a self-contained sub-task to the locally running DevEco Code agent (OpenCode web server, default http://127.0.0.1:4096, override with DEVECO_WEB_BASE). DevEco Code runs its own agentic loop (tools + reasoning) on a separate model and returns a final text answer. Use it for a well-scoped sub-task you would otherwise hand to a sub-agent: it offloads the work and its context off this session. Delegations are serialized (one at a time). The sub-agent has no memory of this conversation, so put ALL needed context (file paths, constraints, expected output) into `task`. model selects what DevEco Code requests (default deepseek-v4-pro; deepseek-v4-flash is cheaper and faster for small tasks).",
    parameters: {
      task: {
        type: "string",
        description: "Complete, self-contained sub-task for the DevEco Code agent. Include all context, file paths, constraints and the expected output format. The sub-agent has no access to this conversation."
      },
      model: {
        type: "string",
        description: "Model DevEco Code should request. Default deepseek-v4-pro. Use deepseek-v4-flash for cheap, small sub-tasks."
      }
    },
    output: {
      schema: resultSchema,
      render: renderResult
    },
    isConcurrencySafe: () => false,
    presentCall: present("generic", "Delegate to DevEco Code agent", "write", "task"),
    async execute(args, _exec) {
      const base = (process.env.DEVECO_WEB_BASE ?? "http://127.0.0.1:4096").replace(/\/+$/, "");
      const headers = { "content-type": "application/json" };
      const model = args.model ?? "deepseek-v4-pro";
      const t0 = Date.now();
      const probe = await fetch(`${base}/session`, {
        method: "POST", headers, body: "{}"
      }).catch(() => null);
      if (!probe?.ok) {
        return {
          ok: false, command: `POST ${base}/session`, exitCode: 1,
          durationMs: Date.now() - t0, timedOut: false, truncated: false,
          output: `DevEco Code web 服务不可访问(${base})。请先启动 DevEco Code(127.0.0.1:4096) 再试。`
        };
      }
      const { id } = await probe.json();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 300000);
      let res, text = "", body = null, aborted = false;
      try {
        res = await fetch(`${base}/session/${id}/message`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            parts: [{ type: "text", text: args.task }],
            info: { providerID: "deepseek", model }
          }),
          signal: controller.signal
        });
        text = await res.text();
        try { body = JSON.parse(text); } catch { body = null; }
      } catch (e) {
        aborted = controller.signal.aborted;
        if (!aborted) throw e;
      } finally {
        clearTimeout(timer);
      }
      const ms = Date.now() - t0;
      if (aborted) {
        return { ok: false, command: `POST ${base}/session/${id}/message`, exitCode: 1, durationMs: ms, timedOut: true, truncated: false, output: "DevEco Code 5 分钟内未返回(超时中止)。" };
      }
      if (!res?.ok || body == null) {
        return { ok: false, command: `POST ${base}/session/${id}/message`, exitCode: res?.status ?? 1, durationMs: ms, timedOut: false, truncated: false, output: `DevEco Code 调用失败(HTTP ${res?.status ?? "?"}): ${(text || "无响应").slice(0, 500)}` };
      }
      const texts = (body.parts ?? [])
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n")
        .trim();
      if (texts.length === 0) {
        return { ok: false, command: `POST ${base}/session/${id}/message`, exitCode: 1, durationMs: ms, timedOut: false, truncated: false, output: "DevEco Code 未返回文本结果(parts 中没有 text)。" };
      }
      const cost = body.info?.cost;
      const total = body.info?.tokens?.total;
      const meta = cost !== void 0 ? `\n\n[dev_code · ${model} · session ${id.slice(0, 8)} · ${ms}ms · cost ¥${Number(cost).toFixed(4)} · ${total ?? "?"} tok]` : "";
      return { ok: true, command: `dev_code → ${model} (session ${id.slice(0, 8)})`, exitCode: 0, durationMs: ms, timedOut: false, truncated: false, output: texts + meta };
    }
  }));

  for (const tool of tools) ctx.tools.register(tool);
  console.error(`[deveco-bridge] registered ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
}

export { apply, inject, name };
