const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── Health Check ────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "LayerAI Backend (Gemini)", version: "1.0.0" });
});

// ─── Analyze Image ───────────────────────────────────────────────
app.post("/analyze-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const imagePart = {
      inlineData: {
        data: req.file.buffer.toString("base64"),
        mimeType: req.file.mimetype,
      },
    };

    const prompt = `You are an expert image analysis AI for a design tool called LayerAI.
Analyze this image and return ONLY a valid JSON object with no markdown, no backticks, no explanation.
Use this exact structure:
{
  "status": "success",
  "endpoint": "/analyze-image",
  "analysis": {
    "subject": {
      "detected": true,
      "description": "brief description of main subject",
      "maskable": true
    },
    "color_grade": {
      "style": "e.g. Teal-Orange, Matte, Vintage, Cinematic",
      "temperature": "warm | cool | neutral",
      "saturation": "low | medium | high",
      "dominant_colors": ["#hex1", "#hex2", "#hex3"]
    },
    "adjustments": {
      "brightness": 0,
      "contrast": 0,
      "highlights": 0,
      "shadows": 0,
      "vibrance": 0,
      "clarity": 0
    },
    "effects": ["list", "of", "detected", "effects"],
    "layers": [
      { "name": "Background", "type": "background", "blend_mode": "Normal", "opacity": 100 },
      { "name": "Subject", "type": "subject_mask", "blend_mode": "Normal", "opacity": 100 },
      { "name": "Color Grade", "type": "adjustment", "blend_mode": "Overlay", "opacity": 75 }
    ],
    "psd_complexity": "simple | medium | complex",
    "estimated_layers": 4,
    "photoshop_tips": ["specific tip 1", "specific tip 2"]
  }
}`;

    const result = await model.generateContent([prompt, imagePart]);
    const text = result.response.text();
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Extract Subject ─────────────────────────────────────────────
app.post("/extract-subject", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const imagePart = {
      inlineData: {
        data: req.file.buffer.toString("base64"),
        mimeType: req.file.mimetype,
      },
    };

    const prompt = `You are an expert at identifying subjects in images for masking.
Return ONLY valid JSON, no markdown, no backticks:
{
  "status": "success",
  "endpoint": "/extract-subject",
  "subjects": [
    {
      "name": "subject name",
      "type": "person | object | animal | text | other",
      "position": "center | left | right | top | bottom",
      "coverage_percent": 40,
      "mask_difficulty": "easy | medium | hard",
      "edges": "sharp | soft | mixed",
      "background_separation": "good | medium | poor"
    }
  ],
  "masking_technique": "Quick Selection | Pen Tool | Select Subject | Channels",
  "estimated_mask_time_minutes": 5
}`;

    const result = await model.generateContent([prompt, imagePart]);
    const text = result.response.text();
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
    if (!description) return res.status(400).json({ error: "Send a 'description' field" });

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `You are an expert video editor and After Effects specialist.
Analyze this video description and return ONLY valid JSON, no markdown, no backticks:
Description: "${description}"

{
  "status": "success",
  "endpoint": "/analyze-video",
  "analysis": {
    "detected_effects": ["list", "of", "effects"],
    "color_grade": {
      "style": "grade name",
      "lut_suggestion": "LUT name",
      "primary_correction": { "lift": 0, "gamma": 0, "gain": 0 }
    },
    "motion": {
      "camera_movement": "static | pan | zoom | handheld",
      "speed_ramping": true,
      "stabilization_needed": false
    },
    "after_effects_layers": [
      { "name": "Layer name", "type": "adjustment | footage | solid | text", "effect": "effect name", "keyframes": true }
    ],
    "plugins_needed": ["list of AE plugins"],
    "complexity": "simple | medium | complex",
    "estimated_ae_time_hours": 2,
    "ae_tips": ["tip 1", "tip 2"]
  }
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LayerAI Backend (Gemini) running on port ${PORT}`));
