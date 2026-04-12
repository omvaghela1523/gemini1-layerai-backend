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
  res.json({ status: "ok", service: "LayerAI Backend", version: "1.0.0" });
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
        { type: "text", text: `Analyze this image and return ONLY valid JSON:\n{"status":"success","endpoint":"/analyze-image","analysis":{"subject":{"detected":true,"description":"subject description","maskable":true},"color_grade":{"style":"grade name","temperature":"warm","saturation":"medium","dominant_colors":["#hex1","#hex2","#hex3"]},"adjustments":{"brightness":0,"contrast":0,"highlights":0,"shadows":0,"vibrance":0,"clarity":0},"effects":["effect1"],"layers":[{"name":"Background","type":"background","blend_mode":"Normal","opacity":100},{"name":"Subject","type":"subject_mask","blend_mode":"Normal","opacity":100},{"name":"Color Grade","type":"adjustment","blend_mode":"Overlay","opacity":75}],"psd_complexity":"medium","estimated_layers":4,"photoshop_tips":["tip1","tip2"]}}` }
      ]}]
    });
    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
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
        { type: "text", text: `Identify subjects. Return ONLY valid JSON:\n{"status":"success","endpoint":"/extract-subject","subjects":[{"name":"subject","type":"person","position":"center","coverage_percent":40,"mask_difficulty":"medium","edges":"mixed","background_separation":"good"}],"masking_technique":"Select Subject","estimated_mask_time_minutes":5}` }
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
      messages: [{ role: "user", content: `Analyze video: "${description}". Return ONLY valid JSON:\n{"status":"success","endpoint":"/analyze-video","analysis":{"detected_effects":["effect1"],"color_grade":{"style":"Cinematic","lut_suggestion":"Teal-Orange LUT","primary_correction":{"lift":0,"gamma":0,"gain":0}},"motion":{"camera_movement":"static","speed_ramping":false,"stabilization_needed":false},"after_effects_layers":[{"name":"Color Grade","type":"adjustment","effect":"Lumetri Color","keyframes":false}],"plugins_needed":["none"],"complexity":"medium","estimated_ae_time_hours":2,"ae_tips":["tip1","tip2"]}}` }]
    });
    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LayerAI Backend running on port ${PORT}`));
