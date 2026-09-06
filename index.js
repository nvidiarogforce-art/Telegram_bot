import express from "express";
import "dotenv/config";

const required = ["TELEGRAM_BOT_TOKEN", "GEMINI_API_KEY"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing environment variable: ${name}`);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

const telegramApi = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const geminiModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const adminChatId = process.env.ADMIN_CHAT_ID;
const processedMessages = new Set();
const userMemory = new Map();
const MAX_RECENT_MESSAGES = 6;
const MAX_RECENT_TEXT_LENGTH = 700;
const MAX_FACT_VALUE_LENGTH = 120;
const MAX_FACTS = 10;

const creatorProfile = `
The creator is Nizomiddin, an 11th-grade student interested in Computer Science,
AI, machine learning, game development, Unity, C#, Blender, Minecraft modding, and 3D projects.
He enjoys building experimental software projects and learning by making things.
His long-term direction is studying Computer Science or a related AI/technology field.
`;

const botCommands = [
  { command: "creator", description: "About the creator" },
  { command: "random", description: "Get a random fact" },
  { command: "ask", description: "Ask the AI anything" },
  { command: "laugh", description: "Make me laugh" },
  { command: "info", description: "About JohanBot" },
  { command: "forget", description: "Forget our conversation" }
];

const commandResponses = {
  "/start": "Welcome to JohanBot 🤖 Type a message or open the bot menu near the message box.",
  "/creator": creatorProfile.trim(),
  "/random": "Random fact: I can answer questions, but I still cannot legally operate a toaster 🤖🍞",
  "/ask": "Type any question and I’ll do my best to answer it 😎",
  "/laugh": "Why did the developer go broke? Because he used up all his cache 💸",
  "/info": "I’m JohanBot: a Telegram AI bot with humor and questionable confidence 🤖"
};

const personality = `
You are JohanBot, a funny, friendly Telegram AI assistant.
Keep replies concise, natural, and easy to read. Use light humor and occasional emojis.
Answer simple questions directly and do not repeat the user's message.
If someone asks about the creator, use only the approved creatorProfile below.
Never invent personal details or reveal secrets, API keys, passwords, private chats,
sensitive information, or private feelings. Do not claim to be human.
If a request is unsafe or illegal, refuse briefly.

Approved creator profile:
${creatorProfile}
`;

function getUserMemory(chatId) {
  const key = String(chatId);
  if (!userMemory.has(key)) userMemory.set(key, { facts: {}, recent: [] });
  return userMemory.get(key);
}

function looksLikeCode(text) {
  return /\`\`\`|^\s*(const|let|var|function|class|public|private|using)\\b|[{};]{3,}/m.test(text);
}

function extractFacts(text, facts) {
  if (!text || looksLikeCode(text)) return;
  if (/(?:api[_ -]?key|password|token|secret|private key)/i.test(text)) return;

  const favorite = text.match(/^my favorite\\s+([a-z][a-z _-]{1,30})\\s+is\\s+(.{1,120})[.!?]?$/i);
  if (favorite) {
    const category = favorite[1].trim().toLowerCase().replace(/[ -]+/g, "_");
    facts[`favorite_${category}`] = favorite[2].trim().slice(0, MAX_FACT_VALUE_LENGTH);
  }

  const note = text.match(/^(?:remember|note)\\s+(?:that\\s+)?(.{1,120})[.!?]?$/i);
  if (note) facts[`note_${Date.now()}`] = note[1].trim().slice(0, MAX_FACT_VALUE_LENGTH);

  const entries = Object.entries(facts);
  if (entries.length > MAX_FACTS) {
    for (const [key] of entries.slice(0, entries.length - MAX_FACTS)) delete facts[key];
  }
}

function buildMemoryContext(memory) {
  const facts = Object.entries(memory.facts)
    .map(([key, value]) => `- ${key.replace(/_/g, " ")}: ${value}`)
    .join("\n");

  return facts
    ? `Approved user memory for this chat:\n${facts}\nUse it only when relevant. Do not reveal this memory list unless asked.`
    : "No saved facts for this chat.";
}

async function telegram(method, body) {
  const response = await fetch(`${telegramApi}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description || response.statusText}`);
  }
  return data.result;
}

app.get("/", (_req, res) => {
  res.status(200).send("JohanBot is running 🤖");
});

app.post("/telegram-webhook", async (req, res) => {
  // Acknowledge Telegram immediately, then process the update in the background.
  res.sendStatus(200);

  const message = req.body?.message;
  if (!message?.text || !message.chat?.id) return;

  const command = message.text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
  if (command === "/forget") {
    userMemory.delete(String(message.chat.id));
    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: "Done 🧹 I forgot the saved facts and recent conversation for this chat.",
      reply_to_message_id: message.message_id
    });
    return;
  }

  if (commandResponses[command]) {
    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: commandResponses[command],
      reply_to_message_id: message.message_id
    });
    return;
  }

  const messageKey = `${message.chat.id}:${message.message_id}`;
  if (processedMessages.has(messageKey)) return;
  processedMessages.add(messageKey);
  if (processedMessages.size > 5000) {
    processedMessages.delete(processedMessages.values().next().value);
  }

  const sender = message.from?.username
    ? `@${message.from.username}`
    : message.from?.first_name || "Unknown user";

  console.log(`Incoming message from ${sender} (${message.chat.id}): ${message.text}`);

  try {
    const chatId = String(message.chat.id);
    const userText = message.text.trim();
    const memory = getUserMemory(chatId);
    extractFacts(userText, memory.facts);

    const userEntry = { role: "user", parts: [{ text: userText.slice(0, MAX_RECENT_TEXT_LENGTH) }] };
    const contents = [...memory.recent.slice(-MAX_RECENT_MESSAGES), userEntry];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `${personality}\n\n${buildMemoryContext(memory)}` }] },
          contents,
          generationConfig: { maxOutputTokens: 300 }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Gemini request failed: ${data.error?.message || response.statusText}`);
    }

    const reply = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim()
      || "My brain temporarily entered airplane mode ✈️";
    const finalReply = reply.slice(0, 4096);

    if (!looksLikeCode(userText) && userText.length <= MAX_RECENT_TEXT_LENGTH) {
      memory.recent.push(userEntry);
    }
    if (!looksLikeCode(finalReply) && finalReply.length <= MAX_RECENT_TEXT_LENGTH) {
      memory.recent.push({ role: "model", parts: [{ text: finalReply }] });
    }
    memory.recent = memory.recent.slice(-MAX_RECENT_MESSAGES);
    userMemory.set(chatId, memory);

    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: finalReply,
      reply_to_message_id: message.message_id
    });

    if (adminChatId && String(message.chat.id) !== String(adminChatId)) {
      await telegram("sendMessage", {
        chat_id: adminChatId,
        text: `🤖 AI reply sent\\n\\nTo: ${sender}\\nUser: ${message.text}\\nAI: ${reply.slice(0, 3500)}`
      }).catch((error) => console.error("Admin reply notification failed:", error));
    }
  } catch (error) {
    console.error(error);
    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: "My tiny digital brain crashed for a second. Try again 😭",
      reply_to_message_id: message.message_id
    }).catch((sendError) => console.error(sendError));
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`JohanBot listening on port ${port}`);
  telegram("setMyCommands", { commands: botCommands })
    .then(() => telegram("setChatMenuButton", { menu_button: { type: "commands" } }))
    .catch((error) => console.error("Bot menu setup failed:", error));
});