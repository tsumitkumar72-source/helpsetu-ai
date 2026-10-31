
const corsHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 503,
      headers: corsHeaders,
      body: JSON.stringify({ error: "GROQ_API_KEY is not configured." }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];

  const messages = incoming
    .slice(-8)
    .filter(
      (m) =>
        m &&
        ["user", "assistant"].includes(m.role) &&
        typeof m.content === "string"
    )
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 1500),
    }));

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Please send a question." }),
    };
  }

  const system = `You are HelpSetu, a careful and friendly assistant for general information in India.
Reply in Hindi or the language used by the user.
Be concise and practical.
When an image is provided, describe only what is actually visible and answer questions about it.
Do not guess a person's identity or sensitive personal details from an image.
For government schemes, scholarships, jobs, legal, health, financial or time-sensitive matters, do not invent rules or guarantees.
Never ask for OTPs, passwords, PINs, bank details or sensitive personal data.
Keep answers suitable for teenagers.`;

  const image = body.image;
  let model = "openai/gpt-oss-20b";

  if (image) {
    if (typeof image !== "string" || image.length > 11000000) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Image is too large. Please choose a smaller image." }),
      };
    }

    const match = image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);

    if (!match) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Please upload a JPG, PNG, WEBP or GIF image." }),
      };
    }

    const lastMessage = messages[messages.length - 1];

    lastMessage.content = [
      {
        type: "text",
        text: lastMessage.content || "Please describe this image.",
      },
      {
        type: "image_url",
        image_url: { url: image },
      },
    ];

    model = "qwen/qwen3.8-27b";
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    let response;

    try {
      response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: system }, ...messages],
            temperature: 0.4,
            max_completion_tokens: 900,
          }),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        statusCode: response.status === 429 ? 429 : 502,
        headers: corsHeaders,
        body: JSON.stringify({
          error:
            response.status === 429
              ? "AI usage limit reached. Please try again later."
              : "AI provider returned an error. Please check your model and API settings.",
        }),
      };
    }

    const reply = data?.choices?.[0]?.message?.content;

    if (typeof reply !== "string" || !reply.trim()) {
      throw new Error("Empty reply");
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ reply: reply.trim() }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Could not connect to AI. Please try again later.",
      }),
    };
  }
};