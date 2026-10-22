require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

async function run() {
  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL,
      contents: "hello",
    });
    console.log("Success:", response.text);
  } catch(e) {
    console.error("API Error:");
    console.error(e.message);
  }
}
run();
