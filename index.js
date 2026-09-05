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

const mainKeyboard = {
  inline_keyboard: [
    [
      { text: "👤 About the creator", callback_data: "creator_info" },
      { text: "🎲 Random fact", callback_data: "random_fact" }
    ],
    [
      { text: "🧠 Ask the AI", callback_data: "ask_ai" },
      { text: "😂 Make me laugh", callback_data: "make_me_laugh" }
    ],
    [
      { text: "🛠 Bot information", callback_data: "bot_info" }
    ]
  ]
};

const buttonResponses = {
  creator_info: "The creator is currently classified information 🕵️ Ask again after the next security update.",
  random_fact: "Random fact: I can answer questions, but I still cannot legally operate a toaster 🤖🍞",
  ask_ai: "Send me any question and I’ll do my best to answer it 😎",
  make_me_laugh: "Why did the developer go broke? Because he used up all his cache 💸",
  bot_info: "I’m JohanBot: a Telegram AI bot with humor, buttons, and questionable confidence 🤖"
};

const personality = `
You are JohanBot, a funny, friendly Telegram AI assistant.
Keep replies concise, natural, and easy to read. Use light humor and occasional emojis.
If someone asks personal questions about the bot owner, joke that they are conducting an investigation
and reveal only harmless, general information. Never reveal secrets, API keys, passwords, private chats,
or sensitive personal information. Do not claim to be human. If a request is unsafe or illegal, refuse briefly.
`;

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
  const callback = req.body?.callback_query;
  if (callback?.id && callback.message?.chat?.id) {
    res.sendStatus(200);

    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id
    }).catch((error) => console.error("Callback acknowledgement failed:", error));

    const responseText = buttonResponses[callback.data]
      || "That button is still under investigation 🕵️";

    await telegram("sendMessage", {
      chat_id: callback.message.chat.id,
      text: responseText,
      reply_markup: mainKeyboard
    }).catch((error) => console.error("Button response failed:", error));

    return;
  }

  // Acknowledge Telegram immediately so it does not retry the same update.
  res.sendStatus(200);

  const message = req.body?.message;
  if (!message?.text || !message.chat?.id) return;

  const messageKey = `${message.chat.id}:${message.message_id}`;
  if (processedMessages.has(messageKey)) return;
  processedMessages.add(messageKey);
  if (processedMessages.size > 5000) processedMessages.delete(processedMessages.values().next().value);

  const sender = message.from?.username
    ? `@${message.from.username}`
    : message.from?.first_name || "Unknown user";

  console.log(`Incoming message from ${sender} (${message.chat.id}): ${message.text}`);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: personality }] },
          contents: [{ role: "user", parts: [{ text: message.text }] }],
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
    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: reply.slice(0, 4096),
      reply_to_message_id: message.message_id,
      reply_markup: mainKeyboard
    });

    if (adminChatId && String(message.chat.id) !== String(adminChatId)) {
      await telegram("sendMessage", {
        chat_id: adminChatId,
        text: `🤖 AI reply sent\n\nTo: ${sender}\nUser: ${message.text}\nAI: ${reply.slice(0, 3500)}`
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
app.listen(port, () => console.log(`JohanBot listening on port ${port}`));
