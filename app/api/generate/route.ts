export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 1.2 * 1024 * 1024;
const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
const MODEL = "qwen-image-3.0-pro";

export async function POST(request: Request) {
  try {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    const baseUrl = process.env.DASHSCOPE_BASE_URL?.replace(/\/$/, "");
    if (!apiKey || !baseUrl) {
      return Response.json({
        error: "尚未配置千问图像服务。请在 Vercel 项目环境变量中设置 DASHSCOPE_API_KEY 和 DASHSCOPE_BASE_URL，然后重新部署。"
      }, { status: 503 });
    }

    const form = await request.formData();
    const uploads: File[] = [];
    for (const name of ["person", "pose", "outfit"] as const) {
      const file = form.get(name);
      if (!(file instanceof File)) return Response.json({ error: "请上传三张参考图片。" }, { status: 400 });
      if (!allowed.has(file.type)) return Response.json({ error: "仅支持 JPG、PNG、WEBP 图片。" }, { status: 400 });
      if (file.size > MAX_BYTES) return Response.json({ error: "单张图片不能超过 1.2MB。" }, { status: 400 });
      uploads.push(file);
    }
    if (uploads.reduce((sum, file) => sum + file.size, 0) > 4 * 1024 * 1024) {
      return Response.json({ error: "三张图片合计不能超过 4MB。" }, { status: 400 });
    }

    const brief = String(form.get("prompt") || "").slice(0, 1800);
    const prompt = [
      "Create a high-end, photorealistic fashion editorial image using exactly three reference images.",
      "Reference image 1 defines the person's identity and appearance. Preserve the recognizable face, hairstyle, and overall identity.",
      "Reference image 2 defines only the pose, body orientation, camera angle, and composition.",
      "Reference image 3 defines the outfit. Transfer its garment design to the person in image 1, preserving silhouette, construction, colors, patterns, fabric texture, trims, closures, and distinctive details.",
      "Do not copy the person from image 2 or the background from image 3. Keep the three reference roles separate.",
      "Produce a polished, fully clothed, non-sexual fashion photograph suitable for a general audience. Use opaque everyday or editorial clothing, a natural pose, balanced framing, realistic anatomy, accurate garment fit, professional studio or tasteful editorial lighting.",
      "Prioritize fidelity to the supplied outfit and person over adding creative embellishments. Do not invent logos, text, watermarks, accessories, or extra garments.",
      "User's additional brief: " + brief
    ].join("\n");

    const imageInputs = await Promise.all(uploads.map(async file => {
      const bytes = Buffer.from(await file.arrayBuffer());
      return `data:${file.type};base64,${bytes.toString("base64")}`;
    }));

    const upstream = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        image: imageInputs,
        size: "1024x1536",
        n: 1,
        prompt_extend: true,
        watermark: false
      }),
      signal: AbortSignal.timeout(55000)
    });

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok || data?.error) {
      const message = data?.error?.message || data?.message || "千问图像服务暂时无法完成请求，请检查 API Key、地域和账户额度。";
      return Response.json({ error: message }, { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 });
    }

    const imageUrl = data?.data?.[0]?.url;
    if (typeof imageUrl !== "string") {
      return Response.json({ error: "千问服务未返回图片地址，请稍后重试。" }, { status: 502 });
    }

    const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
    if (!imageResponse.ok) {
      return Response.json({ error: "生成图片暂时无法下载，请重新生成。" }, { status: 502 });
    }
    const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
    if (!imageBytes.length || imageBytes.length > 12 * 1024 * 1024) {
      return Response.json({ error: "生成图片大小异常，请重新生成。" }, { status: 502 });
    }
    return Response.json({ image: imageBytes.toString("base64") });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return Response.json({ error: "生成耗时较长，服务请求超时，请稍后重试。" }, { status: 504 });
    }
    return Response.json({ error: "服务器处理失败，请检查图片格式或稍后重试。" }, { status: 500 });
  }
}
