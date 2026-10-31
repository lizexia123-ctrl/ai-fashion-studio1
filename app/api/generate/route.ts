export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 1.2 * 1024 * 1024;
const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
const MODEL = "@cf/black-forest-labs/flux-2-klein-9b";

export async function POST(request: Request) {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !token) {
      return Response.json({ error: "服务器尚未配置 Cloudflare Workers AI，请检查 Vercel 环境变量。" }, { status: 500 });
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
      "Create a polished, realistic fashion e-commerce concept image using three reference images.",
      "Image 1 is the person reference; image 2 is only a pose and composition reference; image 3 is the clothing design reference.",
      "Apply the clothing design from image 3 to the person in image 1 while using a similar natural, non-suggestive pose and composition to image 2.",
      "Preserve garment construction, color, pattern, fabric appearance and visible details as faithfully as possible.",
      "Aim for the boldest fashion-editorial look that remains clearly non-sexual and suitable for a general audience: contemporary silhouettes, stylish layering, tasteful color blocking, elegant tailoring, and fashion-forward but practical outfits.",
      "Keep the subject fully clothed in opaque everyday or editorial clothing. Avoid nudity, lingerie, fetish styling, transparent garments over intimate areas, sexualized posing, or framing that emphasizes intimate body parts.",
      "Show the outfit clearly and confidently through full-body or three-quarter fashion photography, with natural posture and balanced composition. Prioritize garment design, fit, fabric, and styling rather than body exposure."
      "Use a clean professional fashion-catalog presentation. Do not add text, logos, watermarks, or unrelated accessories.",
      "User brief: " + brief
    ].join("\n");

    const apiForm = new FormData();
    apiForm.append("prompt", prompt);
    apiForm.append("width", "768");
    apiForm.append("height", "1024");
    for (let i = 0; i < uploads.length; i++) {
      apiForm.append(`input_image_${i}`, new Blob([await uploads[i].arrayBuffer()], { type: uploads[i].type }), uploads[i].name || `reference-${i}.jpg`);
    }

    const upstream = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: apiForm
    });
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok || data?.success === false) {
      const message = data?.errors?.[0]?.message || data?.error || "Cloudflare 图像服务暂时无法完成请求。请检查 Workers AI 权限、额度或稍后重试。";
      const status = upstream.status === 429 ? 429 : upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
      return Response.json({ error: message }, { status });
    }
    const image = data?.result?.image || data?.result?.data?.[0]?.b64_json || data?.image;
    if (!image || typeof image !== "string") {
      return Response.json({ error: "图像服务没有返回图片，请稍后重试。" }, { status: 502 });
    }
    return Response.json({ image });
  } catch {
    return Response.json({ error: "服务器处理失败，请检查图片格式或稍后重试。" }, { status: 500 });
  }
}
