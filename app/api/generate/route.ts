export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_BYTES = 1.2 * 1024 * 1024;
const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
const MODEL = "qwen-image-3.0-pro";
function config() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const base = process.env.DASHSCOPE_BASE_URL?.replace(/\/$/, "").replace(/\/compatible-mode\/v1$/, "");
  if (!apiKey || !base) throw new Error("未配置百炼 API 环境变量。");
  return { apiKey, base };
}
async function jsonOrError(r: Response) {
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.message || d?.error?.message || `百炼接口错误：HTTP ${r.status}`);
  return d;
}
export async function POST(request: Request) {
  try {
    const { apiKey, base } = config();
    const form = await request.formData();
    const files: File[] = [];
    for (const key of ["person", "pose", "outfit"] as const) {
      const f = form.get(key);
      if (!(f instanceof File)) return Response.json({ error: "请上传三张参考图片。" }, { status: 400 });
      if (!allowed.has(f.type)) return Response.json({ error: "仅支持 JPG、PNG、WEBP 图片。" }, { status: 400 });
      if (f.size > MAX_BYTES) return Response.json({ error: "单张图片不能超过 1.2MB。" }, { status: 400 });
      files.push(f);
    }
    if (files.reduce((n, f) => n + f.size, 0) > 4 * 1024 * 1024) return Response.json({ error: "三张图片合计不能超过 4MB。" }, { status: 400 });
    const brief = String(form.get("prompt") || "").slice(0, 1800);
    const prompt = [
      "Create a high-end, photorealistic fashion editorial image using exactly three reference images.",
      "Image 1 defines the person's identity and appearance. Image 2 defines only pose, body orientation, camera angle, and composition. Image 3 defines the outfit; transfer its design, silhouette, colors, patterns, fabric texture, trims, closures, and details to the person in image 1.",
      "Do not copy the person from image 2 or the background from image 3. Keep the three reference roles separate.",
      "Create a polished, fully clothed, non-sexual fashion photograph suitable for a general audience, with natural pose, realistic anatomy, accurate garment fit, and professional lighting.",
      "User brief: " + brief
    ].join("\n");
    const content: Array<{image?: string; text?: string}> = await Promise.all(files.map(async f => {
      const bytes = Buffer.from(await f.arrayBuffer());
      return { image: `data:${f.type};base64,${bytes.toString("base64")}` };
    }));
    content.push({ text: prompt });
    const r = await fetch(`${base}/api/v1/services/aigc/image-generation/generation`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-DashScope-Async": "enable" },
      body: JSON.stringify({ model: MODEL, input: { messages: [{ role: "user", content }] }, parameters: { prompt_extend: true, enable_thinking: false, size: "1024*1536", n: 1, watermark: false } }),
      signal: AbortSignal.timeout(50000)
    });
    const d = await jsonOrError(r);
    if (!d?.output?.task_id) throw new Error(d?.message || "百炼未返回任务编号。");
    return Response.json({ taskId: d.output.task_id, status: d.output.task_status || "PENDING" });
  } catch (e) {
    console.error("[generate:create]", e);
    return Response.json({ error: e instanceof Error ? e.message : "创建生成任务失败。" }, { status: 500 });
  }
}
export async function GET(request: Request) {
  try {
    const taskId = new URL(request.url).searchParams.get("taskId");
    if (!taskId || !/^[a-zA-Z0-9-]{10,100}$/.test(taskId)) return Response.json({ error: "任务编号无效。" }, { status: 400 });
    const { apiKey, base } = config();
    const r = await fetch(`${base}/api/v1/tasks/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20000) });
    const d = await jsonOrError(r);
    const o = d?.output || {};
    if (o.task_status === "FAILED" || o.task_status === "CANCELED") return Response.json({ status: o.task_status, error: o.message || d?.message || "图像生成失败。" });
    if (o.task_status !== "SUCCEEDED") return Response.json({ status: o.task_status || "RUNNING" });
    const url = o.choices?.[0]?.message?.content?.find((x: {image?: string}) => x.image)?.image;
    if (typeof url !== "string") throw new Error("任务已完成，但没有返回图片地址。");
    const img = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!img.ok) throw new Error("生成图片下载失败。");
    const bytes = Buffer.from(await img.arrayBuffer());
    if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error("生成图片大小异常。");
    return Response.json({ status: "SUCCEEDED", image: bytes.toString("base64") });
  } catch (e) {
    console.error("[generate:poll]", e);
    return Response.json({ error: e instanceof Error ? e.message : "查询任务失败。" }, { status: 500 });
  }
}
