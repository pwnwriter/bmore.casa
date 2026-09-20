export function recordCanvasTour(canvas: HTMLCanvasElement, title: string, credits: () => string, onDone: (blob: Blob, extension: string) => void, onError: () => void, audio?: MediaStream) {
  const output = document.createElement("canvas"); output.width = 1280; output.height = 720;
  const ctx = output.getContext("2d")!;
  const stream = output.captureStream(30);
  audio?.getAudioTracks().forEach(track => stream.addTrack(track.clone()));
  const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type));
  if (!mime) { stream.getTracks().forEach(t => t.stop()); throw new Error("Video recording is unsupported in this browser."); }
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  let frame = 0;
  const draw = () => {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1280, 720);
    const scale = Math.min(1280 / canvas.width, 720 / canvas.height), w = canvas.width * scale, h = canvas.height * scale;
    ctx.drawImage(canvas, (1280 - w) / 2, (720 - h) / 2, w, h);
    ctx.font = "14px sans-serif";
    const lines: string[] = []; let line = "";
    for (const word of credits().split(" ")) {
      if (ctx.measureText(`${line} ${word}`).width > 1230 && line) { lines.push(line); line = word; }
      else line += `${line ? " " : ""}${word}`;
    }
    lines.push(line);
    const footerHeight = 44 + lines.length * 17;
    ctx.fillStyle = "rgba(0,0,0,.8)"; ctx.fillRect(0, 0, 1280, 55); ctx.fillRect(0, 720 - footerHeight, 1280, footerHeight);
    ctx.fillStyle = "#fff"; ctx.font = "20px sans-serif"; ctx.fillText(title, 20, 35, 1220);
    ctx.font = "14px sans-serif"; ctx.fillText("Google Photorealistic 3D / Aerial imagery; capture date varies", 20, 744 - footerHeight, 1230);
    lines.forEach((text, i) => ctx.fillText(text, 20, 764 - footerHeight + i * 17));
    frame = requestAnimationFrame(draw);
  };
  const stop = () => { if (recorder.state !== "inactive") recorder.stop(); };
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.onerror = () => { onError(); stop(); };
  recorder.onstop = () => {
    cancelAnimationFrame(frame); stream.getTracks().forEach(t => t.stop());
    if (chunks.length) onDone(new Blob(chunks, { type: mime }), mime.includes("mp4") ? "mp4" : "webm");
  };
  draw(); recorder.start(1000);
  return { stop };
}
