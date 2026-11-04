/** Deploy pinned detector weights on this machine. No patient data and no .env.local. */
import {spawn} from "node:child_process";
import {statfsSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {NextResponse} from "next/server";
import {DETECTOR_DEPLOY_MINIMUM,NOT_DEPLOYED,planDetectorDeploy,type DeployReason,type DeployScope} from "../../../lib/detector-deploy-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEAD = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"};
const TEXT: Record<DeployReason, string> = {
  ok: "Сервер подходит. Кнопки скачивают перечисленные веса и запускают службы, для которых уже стоит программа.",
  mac: "Это Mac. Детекторы сюда не ставятся.",
  os: "Нужен Linux-сервер.",
  ram: "Памяти меньше 16 ГБ. Закачка не начата.",
  disk: "Свободного места меньше 30 ГБ. Закачка не начата.",
};

function hostFacts() {
  const disk = statfsSync(os.homedir());
  return {
    platform: process.platform,
    ramBytes: os.totalmem(),
    freeDiskBytes: Number(disk.bavail) * Number(disk.bsize),
  };
}

function pack(extra: Record<string, unknown> = {}) {
  const host = hostFacts();
  const basic = planDetectorDeploy(host, "basic");
  const full = planDetectorDeploy(host, "full");
  return {
    schema: "opus-detector-deploy/v1",
    message: TEXT[basic.reason],
    minimum: DETECTOR_DEPLOY_MINIMUM,
    notDeployed: NOT_DEPLOYED,
    basic, full,
    clinicalValidation: false,
    patientMode: false,
    ...extra,
  };
}

function run(script: string, scope: DeployScope) {
  return new Promise<{code: number; out: string}>((resolve, reject) => {
    const child = spawn("python3", [script, scope], {stdio: ["ignore", "pipe", "pipe"]});
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), scope === "full" ? 2_700_000 : 1_200_000);
    child.stdout.on("data", chunk => {
      out += chunk;
      if (out.length > 100_000) out = out.slice(-100_000);
    });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolve({code: code ?? 1, out}); });
  });
}

export async function GET() {
  return NextResponse.json(pack(), {headers: HEAD});
}

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const scope = raw && typeof raw === "object" ? (raw as {scope?: unknown}).scope : null;
  if (scope !== "basic" && scope !== "full") {
    return NextResponse.json({message: "Не выбрана кнопка."}, {status: 400, headers: HEAD});
  }
  const planned = pack();
  if (!planned[scope].eligible) return NextResponse.json(planned, {status: 409, headers: HEAD});
  const script = path.resolve(process.cwd(), "../scripts/deploy_pinned_detectors.py");
  const result = await run(script, scope).catch(() => ({code: 1, out: ""}));
  let report: {eligible?: unknown; installed?: unknown; failed?: unknown; services?: unknown} = {};
  try { report = JSON.parse(result.out.trim().split("\n").at(-1) || "{}"); }
  catch { report = {}; }
  const failed = Array.isArray(report.failed) ? report.failed : [];
  const services = Array.isArray(report.services) ? report.services : [];
  if (result.code !== 0 || report.eligible !== true || failed.length > 0) {
    return NextResponse.json(pack({
      installed: report.installed ?? [],
      failed,
      services,
      message: "Закачка не завершилась. Несверенные веса не помечены как установленные.",
    }), {status: 502, headers: HEAD});
  }
  const started = services.filter(item => item && typeof item === "object" && (item as {started?: unknown}).started === true);
  return NextResponse.json(pack({
    installed: report.installed ?? [],
    failed: [],
    services,
    message: started.length
      ? "Веса скачаны. Ответившие службы уже видны кнопке «Анализировать», когда приложение открыто на этом сервере как http://127.0.0.1:3000."
      : "Веса скачаны. Службы расчёта не запустились, поэтому «Анализировать» эти модели пока не видит.",
  }), {headers: HEAD});
}
