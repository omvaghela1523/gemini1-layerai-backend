const express = require("express");
const cors = require("cors");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "LayerAI Backend",
    version: "3.0.0",
    pipeline: "7-step pro mode"
  });
});

// =============================================================================
// /analyze-image — Returns full editing PLAN for the 7-step pipeline
// =============================================================================

const PIPELINE_SYSTEM_PROMPT = `You are an expert photo editor analyzing an image to generate a structured PSD editing plan.

Your task: analyze the image and return a complete editing plan as JSON. The downstream system will:
1. Extract subject from image using mask (Remove.bg)
2. Remove subject area and generate a clean background using AI inpainting
3. Place background as bottom layer
4. Place subject as a separate masked layer above
5. Add soft shadow under subject
6. Apply global color adjustments (hue/saturation, cinematic tone)
7. Maintain clean layer naming and grouping

Return ONLY valid JSON (no markdown, no extra text):
{
  "status": "success",
  "subject": {
    "detected": true,
    "type": "person/product/animal/object",
    "description": "brief description of what's in the image",
    "mask_difficulty": "easy/medium/hard"
  },
  "inpaint_prompt": "describe what the background should look like WITHOUT the subject, photorealistic, matching original lighting and scene",
  "shadow": {
    "add": true,
    "offset_x": 10,
    "offset_y": 30,
    "blur": 25,
    "opacity": 140
  },
  "image_assessment": {
    "current_brightness": "dark/normal/bright/overexposed",
    "current_contrast": "flat/normal/high",
    "current_saturation": "dull/normal/vivid/oversaturated",
    "current_temperature": "cool/neutral/warm",
    "issues": ["list of problems found"]
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
    "cb_midtone_cr": 0,
    "cb_midtone_mg": 0,
    "cb_midtone_yb": 0
  },
  "color_grade": {
    "style": "Cinematic/Warm/Cool/Vintage/Natural",
    "add_gradient_map": true
  },
  "use_groups": true
}

CORRECTION RULES (CRITICAL):
- If image is ALREADY bright, use NEGATIVE brightness (reduce it)
- If image is DARK, use POSITIVE brightness (increase it)
- If colors are oversaturated, use NEGATIVE saturation
- If image is dull/flat, increase contrast and saturation slightly
- Most values should be SUBTLE: between -20 to +20
- For levels: midtones=100 means no change, >100=brighter mids, <100=darker mids
- For color balance: positive=toward Red/Green/Blue, negative=toward Cyan/Magenta/Yellow

VALUE RANGES:
- brightness: -150 to 150 (typical: -30 to +30)
- contrast: -50 to 100 (typical: -15 to +25)
- hue: -180 to 180 (typical: -10 to +10, 0 = no shift)
- saturation: -100 to 100 (typical: -25 to +25)
- lightness: -100 to 100 (typical: -10 to +10)
- lvl_shadows: 0 to 253 (input black point)
- lvl_midtones: 10 to 990 (gamma×100, default=100)
- lvl_highlights: 2 to 255 (input white point, default=255)
- cb_* values: -100 to 100 (default=0)

INPAINT PROMPT RULES:
- Describe ONLY the background scene without the subject
- Match the original lighting and atmosphere
- Use photorealistic descriptors
- Examples:
  * Subject on rooftop at sunset → "rooftop terrace at golden hour, city skyline, warm orange sky, photorealistic"
  * Subject in studio → "clean studio backdrop, soft gradient lighting, professional"
  * Subject on beach → "sandy beach with ocean horizon, blue sky with clouds, photorealistic"

SHADOW RULES:
- Direction depends on lighting: shadow falls AWAY from light source
- Sunset/golden hour: longer shadow (offset_y: 40-60)
- Overhead lighting: short shadow (offset_y: 15-25)
- Studio: minimal shadow (offset_y: 10-20, low opacity)
- opacity: 100-180 (lower for soft, higher for harsh)
- blur: 15-40 (higher for soft natural shadow)`;

app.post("/analyze-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mimeType, data: base64Image }
          },
          {
            type: "text",
            text: PIPELINE_SYSTEM_PROMPT
          }
        ]
      }]
    });

    const text = message.content.map((b) => b.text || "").join("");
    const cleaned = text.replace(/```json|```/g, "").trim();

    try {
      const parsed = JSON.parse(cleaned);
      res.json(parsed);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr.message);
      console.error("Raw response:", cleaned.substring(0, 500));
      res.status(500).json({
        error: "Failed to parse Claude response as JSON",
        raw: cleaned.substring(0, 500)
      });
    }
  } catch (err) {
    console.error("Analyze error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// /detect-text — Find text in image with positions
// =============================================================================

app.post("/detect-text", upload.single("image"), async (req, res) => {
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
          {
            type: "image",
            source: { type: "base64", media_type: mimeType, data: base64Image }
          },
          {
            type: "text",
            text: `Find ALL visible text in this image with approximate pixel positions.

Return ONLY valid JSON:
{
  "status": "success",
  "texts": [
    {"text": "exact text", "x": 100, "y": 200, "w": 300, "h": 40}
  ],
  "full_text": "all combined"
}

If NO text: {"status": "success", "texts": [], "full_text": ""}`
          }
        ]
      }]
    });

    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error("Detect text error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// /extract-subject — Subject info for masking
// =============================================================================

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
          {
            type: "text",
            text: `Identify subjects. Return ONLY valid JSON:
{"status":"success","subjects":[{"name":"subject","type":"person","position":"center","coverage_percent":40,"mask_difficulty":"medium","edges":"mixed","background_separation":"good"}],"masking_technique":"Select Subject","estimated_mask_time_minutes":5}`
          }
        ]
      }]
    });

    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LayerAI Backend v3.0 running on port ${PORT}`));
