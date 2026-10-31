const corsHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { ...corsHeaders, "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: "AI setup is incomplete. GROQ_API_KEY is not configured in Netlify." }) };
  }
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON" }) };
  }
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const messages = incoming.slice(-8).filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Please send a question." }) };
  }
  const language = body.language === "en" ? "English" : "Hindi or the language used by the user";
  const system = `You are HelpSetu, a careful and friendly assistant for general information in India. Reply in ${language}. Be concise and practical. For government schemes, scholarships, jobs, legal, health, financial or time-sensitive matters, do not invent eligibility, dates, guarantees, or official rules; advise checking the relevant official source. Never ask for OTPs, passwords, PINs, bank details, precise home address, or other sensitive personal data. Do not claim to be a government office or professional. If a request is unsafe or high-stakes, give safe general guidance and encourage an appropriate trusted adult or qualified professional. Keep answers suitable for teenagers.`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-oss-20b", messages: [{ role: "system", content: system }, ...messages], temperature: 0.4, max_tokens: 700 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { statusCode: response.status === 429 ? 429 : 502, headers: corsHeaders, body: JSON.stringify({ error: response.status === 429 ? "AI usage limit reached. Please try again later." : "AI provider returned an error. Check the model and API key settings." }) };
    }
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) throw new Error("Empty reply");
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: reply.trim() }) };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: "Could not connect to AI. Please try again later." }) };
  }
};