"use client";
import { useState } from "react";
type Slot = { file: File | null; preview: string };
const empty = (): Slot => ({ file: null, preview: "" });
export default function Home() {
  const [person, setPerson] = useState<Slot>(empty);
  const [pose, setPose] = useState<Slot>(empty);
  const [outfit, setOutfit] = useState<Slot>(empty);
  const [prompt, setPrompt] = useState("将服装参考图中的服装设计，合理呈现在人物参考图中；姿态参考图只用于构图和站姿参考。保留服装的主要款式、颜色、面料质感和细节，生成自然、得体、适合日常服装展示的电商模特图。");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("准备提交生成任务…");
  const [error, setError] = useState("");
  function selectFile(file: File | undefined, setter: (v: Slot) => void) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("请上传 JPG、PNG 或 WEBP 图片。"); return; }
    if (file.size > 1.2 * 1024 * 1024) { setError("单张图片暂限 1.2MB，请先压缩图片。"); return; }
    setter({ file, preview: URL.createObjectURL(file) }); setError("");
  }
  async function resizeForModel(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("图片处理失败。");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    return await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("图片压缩失败。")), "image/jpeg", 0.92));
  }
  async function generate() {
    if (!person.file || !pose.file || !outfit.file) { setError("请先上传人物、姿势和服装三张参考图。"); return; }
    if (person.file.size + pose.file.size + outfit.file.size > 4 * 1024 * 1024) { setError("三张图片合计不能超过 4MB。"); return; }
    setBusy(true); setError(""); setResult(""); setProgress("正在提交任务…");
    try {
      const [p, s, o] = await Promise.all([resizeForModel(person.file), resizeForModel(pose.file), resizeForModel(outfit.file)]);
      const body = new FormData(); body.append("person", p, "person.jpg"); body.append("pose", s, "pose.jpg"); body.append("outfit", o, "outfit.jpg"); body.append("prompt", prompt);
      const submit = await fetch("/api/generate", { method: "POST", body });
      const task = await submit.json(); if (!submit.ok) throw new Error(task.error || "提交任务失败。");
      if (!task.taskId) throw new Error("服务没有返回任务编号。");
      const start = Date.now();
      while (Date.now() - start < 8 * 60 * 1000) {
        await new Promise(resolve => setTimeout(resolve, 4000));
        const r = await fetch("/api/generate?taskId=" + encodeURIComponent(task.taskId), { cache: "no-store" });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || "查询生成进度失败。");
        if (d.status === "SUCCEEDED" && d.image) { setResult("data:image/png;base64," + d.image); setProgress("生成完成"); return; }
        if (d.status === "FAILED" || d.status === "CANCELED") throw new Error(d.error || "图像生成失败。");
        setProgress(d.status === "PENDING" ? "任务排队中…" : "模型正在生成图片，请稍候…");
      }
      throw new Error("任务仍在处理中，等待时间已较长，请稍后重试。");
    } catch (e) { setError(e instanceof Error ? e.message : "发生未知错误。"); }
    finally { setBusy(false); }
  }
  const cards = [
    { title: "人物参考图", hint: "人物与整体呈现参考", slot: person, setter: setPerson },
    { title: "姿势参考图", hint: "站姿、动作和构图参考", slot: pose, setter: setPose },
    { title: "服装参考图", hint: "款式、颜色和细节参考", slot: outfit, setter: setOutfit }
  ];
  return <main className="shell">
    <header className="top"><div className="mark">AF</div><div><p className="eyebrow">CREATIVE WORKSPACE</p><h1>AI Fashion Studio</h1></div></header>
    <section className="intro"><p className="eyebrow">THREE-IMAGE DESIGN</p><h2>让灵感，成为一套完整造型</h2><p>上传三张参考图，组合人物、姿态与服装元素，生成新的服装展示创意。</p></section>
    <section className="uploadGrid">{cards.map((card, i) => <article className="uploadCard" key={card.title}>
      <div className="cardHead"><span className="number">0{i+1}</span><div><h3>{card.title}</h3><p>{card.hint}</p></div></div>
      <label className="drop">{card.slot.preview ? <img src={card.slot.preview} alt={card.title + "预览"} /> : <div className="placeholder"><span>＋</span><b>选择图片</b><small>JPG / PNG / WEBP · 最大 1.2MB</small></div>}
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => selectFile(e.target.files?.[0], card.setter)} />
      </label>{card.slot.file && <p className="filename">{card.slot.file.name}</p>}
    </article>)}</section>
    <section className="promptBox"><div className="sectionTitle"><div><p className="eyebrow">DESIGN BRIEF</p><h3>创作要求</h3></div><span>可自行调整</span></div>
      <textarea value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={1800} />
      <p className="note">请使用你有权使用的图片。生成结果用于服装创意参考；请保持人物着装得体，不使用裸露或性化内容。</p>
      <button className="generate" onClick={generate} disabled={busy}>{busy ? "正在生成，请稍候…" : "✦ 生成服装创意图"}</button>
      {busy && <p className="note" aria-live="polite">{progress}</p>}{error && <p className="error">{error}</p>}
    </section>
    {result && <section className="resultBox"><div className="sectionTitle"><div><p className="eyebrow">YOUR CREATION</p><h3>生成结果</h3></div><a className="download" href={result} download="ai-fashion-design.png">下载图片 ↓</a></div><img className="resultImage" src={result} alt="生成的服装创意图" /></section>}
    <footer>AI Fashion Studio <span>·</span> 创意设计工作台</footer>
  </main>;
}
