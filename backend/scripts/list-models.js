require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

async function run() {
  try {
    const models = await ai.models.list();
    for await (const model of models) {
      console.log(model.name);
    }
  } catch(e) {
    console.error("API Error:");
    console.error(e.message);
  }
}
run();
