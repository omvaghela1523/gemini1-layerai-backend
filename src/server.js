const express = require("express");
const cors = require("cors");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "LayerAI Backend", version: "2.0.0" });
});

app.post("/analyze-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });
    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mimeType, data: base64Image } },
        { type: "text", text: `You are a professional photo editor. Analyze this image and determine what CORRECTIVE adjustments are needed to make it look professionally edited.

IMPORTANT RULES:
- If the image is ALREADY bright, give NEGATIVE brightness (reduce it)
- If the image is DARK, give POSITIVE brightness (increase it)
- If colors are ALREADY saturated, give NEGATIVE saturation (reduce it)
- If image is DULL/FLAT, give POSITIVE contrast and saturation
- If image has a color cast, use color_balance to CORRECT it
- Values should be SUBTLE corrections, not extreme. Most values should be between -20 to +20
- Think like a professional retoucher: enhance what's good, fix what's bad

Return ONLY valid JSON with no extra text:
{
  "status": "success",
  "analysis": {
    "image_assessment": {
      "current_brightness": "dark/normal/bright/overexposed",
      "current_contrast": "flat/normal/high",
      "current_saturation": "dull/normal/vivid/oversaturated",
      "current_temperature": "cool/neutral/warm",
      "issues": ["list of problems found"]
    },
    "subject": {
      "detected": true,
      "description": "what is in the image",
      "maskable": true
    },
    "corrections": {
      "brightness": 0,
      "contrast": 0,
      "hue": 0,
      "saturation": 0,
      "lightness": 0,
      "lvl_shadows": 0,
      "lvl_midtones": 100,
      "lvl_highlights": 255,
      "cb_shadow_cr": 0,
      "cb_shadow_mg": 0,
      "cb_shadow_yb": 0,
      "cb_midtone_cr": 0,
      "cb_midtone_mg": 0,
      "cb_midtone_yb": 0,
      "cb_highlight_cr": 0,
      "cb_highlight_mg": 0,
      "cb_highlight_yb": 0
    },
    "color_grade": {
      "style": "Cinematic",
      "temperature": "warm/cool/neutral"
    },
    "effects": ["vignette"],
    "layers": [
      {"name": "Background", "type": "background"},
      {"name": "Subject", "type": "subject_mask"},
      {"name": "Curves 1", "type": "adjustment"},
      {"name": "Brightness/Contrast 1", "type": "adjustment"},
      {"name": "Hue/Saturation 1", "type": "adjustment"},
      {"name": "Levels 1", "type": "adjustment"},
      {"name": "Color Balance 1", "type": "adjustment"},
      {"name": "Vignette", "type": "pixel"},
      {"name": "Color Grade", "type": "pixel"}
    ]
  }
}

VALUE RANGES:
- brightness: -150 to 150 (keep between -30 to 30 usually)
- contrast: -50 to 100 (keep between -15 to 25 usually)
- hue: -180 to 180 (keep between -10 to 10 usually, 0 = no shift)
- saturation: -100 to 100 (keep between -25 to 25 usually)
- lightness: -100 to 100 (keep between -10 to 10 usually)
- lvl_shadows: 0 to 253 (input black point, 0 = default)
- lvl_midtones: 10 to 990 (gamma×100, 100 = 1.0 = default, >100 = brighter mids, <100 = darker mids)
- lvl_highlights: 2 to 255 (input white point, 255 = default)
- cb values: -100 to 100 (0 = no change, positive = toward Red/Green/Blue)

EXAMPLES:
- Dark indoor photo: brightness +15, contrast +10, lvl_shadows 5, lvl_midtones 115
- Overexposed photo: brightness -20, lvl_highlights 235, contrast +5
- Dull/flat photo: contrast +15, saturation +10, lvl_shadows 8
- Already perfect photo: all values near 0, minimal corrections
- Orange skin tones: cb_midtone_cr -5 (reduce red in midtones)
- Blue color cast: cb_midtone_yb +8 (add yellow to counter blue)` }
      ]}]
    });
    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error("Analyze error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/extract-subject", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });
    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mimeType, data: base64Image } },
        { type: "text", text: `Identify subjects. Return ONLY valid JSON:\n{"status":"success","subjects":[{"name":"subject","type":"person","position":"center","coverage_percent":40,"mask_difficulty":"medium","edges":"mixed","background_separation":"good"}],"masking_technique":"Select Subject","estimated_mask_time_minutes":5}` }
      ]}]
    });
    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/analyze-video", async (req, res) => {
  try {
    const { description } = req.body;
    if (!description) return res.status(400).json({ error: "Send a description field" });
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      messages: [{ role: "user", content: `Analyze video: "${description}". Return ONLY valid JSON:\n{"status":"success","analysis":{"detected_effects":["effect1"],"color_grade":{"style":"Cinematic","lut_suggestion":"Teal-Orange LUT","primary_correction":{"lift":0,"gamma":0,"gain":0}},"motion":{"camera_movement":"static","speed_ramping":false,"stabilization_needed":false},"after_effects_layers":[{"name":"Color Grade","type":"adjustment","effect":"Lumetri Color","keyframes":false}],"plugins_needed":["none"],"complexity":"medium","estimated_ae_time_hours":2,"ae_tips":["tip1","tip2"]}}` }]
    });
    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/detect-text", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });
    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mimeType, data: base64Image } },
        { type: "text", text: `Look at this image and find ALL visible text. For each piece of text, give its approximate position.

Return ONLY valid JSON with no extra text:
{
  "status": "success",
  "texts": [
    {
      "text": "the exact text you see",
      "x": 100,
      "y": 200,
      "w": 300,
      "h": 40
    }
  ],
  "full_text": "all text combined"
}

RULES:
- x, y = top-left corner position in PIXELS (estimate based on image dimensions)
- w = width of the text area in pixels
- h = height of the text area in pixels
- Include ALL text you can see: titles, subtitles, captions, watermarks, labels, buttons, signs
- If NO text is found, return: {"status": "success", "texts": [], "full_text": ""}
- Estimate positions as accurately as possible based on where text appears in the image
- The image dimensions are provided by the upload, use them to estimate pixel positions` }
      ]}]
    });
    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error("Detect text error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LayerAI Backend v2.0 running on port ${PORT}`));
