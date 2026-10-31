export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024;
const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return Response.json({ error: "服务器尚未配置 OPENAI_API_KEY，请在 Vercel 项目环境变量中设置。" }, { status: 500 });

    const form = await request.formData();
    const names = ["person", "pose", "outfit"] as const;
    const uploads: File[] = [];
    for (const name of names) {
      const file = form.get(name);
      if (!(file instanceof File)) return Response.json({ error: "请上传三张参考图片。" }, { status: 400 });
      if (!allowed.has(file.type)) return Response.json({ error: "仅支持 JPG、PNG、WEBP 图片。" }, { status: 400 });
      if (file.size > MAX_BYTES) return Response.json({ error: "单张图片不能超过 12MB。" }, { status: 400 });
      uploads.push(file);
    }

    const brief = String(form.get("prompt") || "").slice(0, 1800);
    const prompt = [
      "Create a polished, realistic fashion e-commerce concept image using the three reference images.",
      "Image 1 is the person reference; image 2 is only a pose and composition reference; image 3 is the clothing design reference.",
      "Apply the clothing design from image 3 to the person in image 1 while using a similar natural, non-suggestive pose and composition to image 2.",
      "Preserve garment construction, color, pattern, fabric appearance and visible details as faithfully as possible.",
      "Keep the subject fully clothed in tasteful everyday fashion. No nudity, lingerie, sexualized styling, or suggestive posing.",
      "Use a clean professional fashion-catalog presentation. Do not add text, logos, watermarks, or unrelated accessories.",
      "User brief: " + brief
    ].join("\n");

    const apiForm = new FormData();
    apiForm.append("model", "gpt-image-2.5-sunburst");
    apiForm.append("prompt", prompt);
    apiForm.append("quality", "high");
    apiForm.append("size", "1024x1536");
    apiForm.append("output_format", "png");
    for (const file of uploads) {
      const bytes = await file.arrayBuffer();
      const blob = new Blob([bytes], { type: file.type });
      apiForm.append("image[]", blob, file.name || "reference.png");
    }

    const upstream = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: apiForm
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      const message = data?.error?.message || "图像服务暂时无法完成请求。";
      return Response.json({ error: message }, { status: upstream.status });
    }
    const image = data?.data?.[0]?.b64_json;
    if (!image) return Response.json({ error: "图像服务没有返回图片，请重试。" }, { status: 502 });
    return Response.json({ image });
  } catch {
    return Response.json({ error: "服务器处理失败，请检查图片格式或稍后重试。" }, { status: 500 });
  }
}
