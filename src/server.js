const express = require("express");
// LayerAI Backend v2.0 with PSD Generation
const cors = require("cors");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const { writePsd } = require("ag-psd");
const sharp = require("sharp");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Health Check ────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "LayerAI Backend + PSD", version: "2.0.0" });
});

// ─── Analyze Image ───────────────────────────────────────────────
app.post("/analyze-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });
    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: base64Image } },
          { type: "text", text: `Analyze this image and return ONLY valid JSON, no markdown:\n{"status":"success","endpoint":"/analyze-image","analysis":{"subject":{"detected":true,"description":"subject description","maskable":true},"color_grade":{"style":"grade name","temperature":"warm","saturation":"medium","dominant_colors":["#hex1","#hex2","#hex3"]},"adjustments":{"brightness":0,"contrast":0,"highlights":0,"shadows":0,"vibrance":0,"clarity":0},"effects":["effect1","effect2"],"layers":[{"name":"Background","type":"background","blend_mode":"Normal","opacity":100},{"name":"Subject","type":"subject_mask","blend_mode":"Normal","opacity":100},{"name":"Color Grade","type":"adjustment","blend_mode":"Overlay","opacity":75}],"psd_complexity":"medium","estimated_layers":4,"photoshop_tips":["tip1","tip2"]}}` }
        ]
      }]
    });
    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate PSD ────────────────────────────────────────────────
app.post("/generate-psd", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const imageBuffer = req.file.buffer;

    // Get image dimensions
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width;
    const height = metadata.height;

    // Get raw RGBA pixels for background
    const bgRaw = await sharp(imageBuffer).ensureAlpha().raw().toBuffer();

    // Step 1 — AI Analysis
    const base64Image = imageBuffer.toString("base64");
    const mimeType = req.file.mimetype;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: base64Image } },
          { type: "text", text: `Analyze this image. Return ONLY valid JSON:\n{"subject":{"description":"brief description"},"color_grade":{"style":"grade name","temperature":"warm","dominant_colors":["#hex1","#hex2"]},"adjustments":{"brightness":0,"contrast":0,"highlights":0,"shadows":0},"effects":["effect1"],"photoshop_tips":["tip1","tip2"]}` }
        ]
      }]
    });

    const text = message.content.map((b) => b.text || "").join("");
    let analysis;
    try {
      analysis = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch(e) {
      analysis = { subject: { description: "Subject" }, color_grade: { style: "Standard" }, effects: [], photoshop_tips: [] };
    }

    // Step 2 — Create color overlay layer (dominant color with opacity)
    const hexColor = (analysis.color_grade?.dominant_colors?.[0] || "#7c3aed").replace("#", "");
    const r = parseInt(hexColor.substring(0, 2), 16);
    const g = parseInt(hexColor.substring(2, 4), 16);
    const b2 = parseInt(hexColor.substring(4, 6), 16);

    // Create color grade overlay pixels
    const overlayRaw = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      overlayRaw[i * 4] = r;
      overlayRaw[i * 4 + 1] = g;
      overlayRaw[i * 4 + 2] = b2;
      overlayRaw[i * 4 + 3] = 40; // low opacity overlay
    }

    // Create vignette layer (dark edges)
    const vignetteRaw = Buffer.alloc(width * height * 4);
    const cx = width / 2, cy = height / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const vigStrength = Math.pow(dist / maxDist, 2);
        vignetteRaw[idx] = 0;
        vignetteRaw[idx + 1] = 0;
        vignetteRaw[idx + 2] = 0;
        vignetteRaw[idx + 3] = Math.floor(vigStrength * 120);
      }
    }

    // Step 3 — Build PSD structure
    const adjustments = analysis.adjustments || {};
    const brightnessVal = Math.max(-150, Math.min(150, (adjustments.brightness || 0) * 1.5));
    const contrastVal = Math.max(-50, Math.min(50, (adjustments.contrast || 0) * 0.5));

    const psd = {
      width,
      height,
      channels: 3,
      bitsPerChannel: 8,
      colorMode: 3, // RGB
      children: [
        // Layer 1 — Background (original image)
        {
          name: "Background",
          top: 0, left: 0,
          width, height,
          canvas: (() => {
            const { createCanvas } = require("canvas");
            const c = createCanvas(width, height);
            const ctx = c.getContext("2d");
            const imgData = ctx.createImageData(width, height);
            imgData.data.set(bgRaw);
            ctx.putImageData(imgData, 0, 0);
            return c;
          })(),
          opacity: 255,
          blendMode: "norm",
        },
        // Layer 2 — Color Grade overlay
        {
          name: `Color Grade — ${analysis.color_grade?.style || "Standard"}`,
          top: 0, left: 0,
          width, height,
          canvas: (() => {
            const { createCanvas } = require("canvas");
            const c = createCanvas(width, height);
            const ctx = c.getContext("2d");
            const imgData = ctx.createImageData(width, height);
            imgData.data.set(overlayRaw);
            ctx.putImageData(imgData, 0, 0);
            return c;
          })(),
          opacity: 180,
          blendMode: "scrn",
        },
        // Layer 3 — Vignette
        {
          name: "Vignette",
          top: 0, left: 0,
          width, height,
          canvas: (() => {
            const { createCanvas } = require("canvas");
            const c = createCanvas(width, height);
            const ctx = c.getContext("2d");
            const imgData = ctx.createImageData(width, height);
            imgData.data.set(vignetteRaw);
            ctx.putImageData(imgData, 0, 0);
            return c;
          })(),
          opacity: 200,
          blendMode: "mul",
        },
        // Layer 4 — Info text layer
        {
          name: `Subject: ${(analysis.subject?.description || "").substring(0, 40)}`,
          top: 0, left: 0,
          width, height,
          canvas: (() => {
            const { createCanvas } = require("canvas");
            const c = createCanvas(width, height);
            return c;
          })(),
          opacity: 0,
          blendMode: "norm",
          hidden: true,
        },
      ],
    };

    // Step 4 — Write PSD
    const psdBuffer = writePsd(psd);

    // Step 5 — Send file
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="layerai-export.psd"`);
    res.setHeader("X-Analysis", JSON.stringify({
      style: analysis.color_grade?.style,
      effects: analysis.effects,
      tips: analysis.photoshop_tips
    }));
    res.send(Buffer.from(psdBuffer));

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Extract Subject ─────────────────────────────────────────────
app.post("/extract-subject", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });
    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: base64Image } },
          { type: "text", text: `Identify subjects for masking. Return ONLY valid JSON:\n{"status":"success","endpoint":"/extract-subject","subjects":[{"name":"subject","type":"person","position":"center","coverage_percent":40,"mask_difficulty":"medium","edges":"mixed","background_separation":"good"}],"masking_technique":"Select Subject","estimated_mask_time_minutes":5}` }
        ]
      }]
    });
    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Analyze Video ───────────────────────────────────────────────
app.post("/analyze-video", async (req, res) => {
  try {
    const { description } = req.body;
    if (!description) return res.status(400).json({ error: "Send a description field" });
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      messages: [{
        role: "user",
        content: `Analyze this video: "${description}". Return ONLY valid JSON:\n{"status":"success","endpoint":"/analyze-video","analysis":{"detected_effects":["effect1"],"color_grade":{"style":"Cinematic","lut_suggestion":"Teal-Orange LUT","primary_correction":{"lift":0,"gamma":0,"gain":0}},"motion":{"camera_movement":"static","speed_ramping":false,"stabilization_needed":false},"after_effects_layers":[{"name":"Color Grade","type":"adjustment","effect":"Lumetri Color","keyframes":false}],"plugins_needed":["none"],"complexity":"medium","estimated_ae_time_hours":2,"ae_tips":["tip1","tip2"]}}`
      }]
    });
    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LayerAI Backend + PSD running on port ${PORT}`));
