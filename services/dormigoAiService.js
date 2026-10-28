import { GoogleGenAI } from "@google/genai";
import { User, Op } from "../models/userModel.js";
import { OwnerRoom } from "../models/ownerModels.js";


export const SYSTEM_KNOWLEDGE = {
  name: "Dormigo",
  tagline: "Official AI Dormitory Navigator for the Municipality of Bongabong",
  municipality: "Municipality of Bongabong, Oriental Mindoro",
  office: "Business Permit & Licensing Office (BPLO)",
  officeAddress: "2F Municipal Building, Poblacion, Bongabong, Oriental Mindoro",
  contactEmail: "bplo@bongabong.gov.ph",
  contactPhone: "(043) 283-5000",
  barangays: [
    "Aplaya","Bagong Bayan I","Bagong Bayan II","Batangan","Bukal",
    "Camantigue","Carmundo","Cawayan","Dayhagan","Formon",
    "Hagan","Hagupit","Ipil","Kaligtasan","Labasan",
    "Labonan","Libertad","Lisap","Luna","Malitbog",
    "Mapasan","Masaguisi","Morente","Orconuma","Poblacion",
    "San Isidro","San Jose","San Roque","Sigange","Sta. Cruz"
  ],
  schools: [
    "Mindoro State University (MinSU - Bongabong Campus)",
    "Bongabong National High School (BNHS)",
    "Eastern Mindoro College (EMC)",
    "Technical Education and Skills Development Authority (TESDA Bongabong)",
    "St. Joseph Academy"
  ]
};

export async function fetchLiveDatabaseContext() {
  try {
    const activeHouses = await User.findAll({
      where: {
        accountType: "boarding_house_owner",
        isSuspended: false,
        isArchived: false,
        [Op.or]: [
          { applicationStatus: "approved" },
          { applicationStatus: null }
        ]
      },
      attributes: [
        "id","fullName","boardingHouseName","boardingHouseAddress",
        "barangay","roomsAvailable","contactNumber","gcashNumber",
        "boardingHouseLatitude","boardingHouseLongitude","applicationStatus"
      ]
    });

    const activeRooms = await OwnerRoom.findAll({
      where: { status: "available" },
      attributes: ["id","ownerId","roomNumber","roomType","capacity","availableSlots","rentalPrice","furnished","aircon","amenities"]
    });

    const houseList = activeHouses.map(h => {
      const rooms = activeRooms.filter(r => r.ownerId === h.id);
      const minPrice = rooms.length > 0 ? Math.min(...rooms.map(r => Number(r.rentalPrice) || 0)) : 0;
      const maxPrice = rooms.length > 0 ? Math.max(...rooms.map(r => Number(r.rentalPrice) || 0)) : 0;
      return {
        id: h.id,
        name: h.boardingHouseName || h.fullName + "'s Boarding House",
        address: h.boardingHouseAddress || h.barangay || "Bongabong",
        barangay: h.barangay || "Poblacion",
        roomsCount: h.roomsAvailable || rooms.length || 1,
        contact: h.contactNumber || "N/A",
        gcash: h.gcashNumber || "N/A",
        minPrice,
        maxPrice,
        priceDisplay: minPrice > 0
          ? (minPrice === maxPrice
              ? `P${minPrice.toLocaleString()}/mo`
              : `P${minPrice.toLocaleString()} - P${maxPrice.toLocaleString()}/mo`)
          : "Contact for rates",
        rooms: rooms.map(r => ({
          type: r.roomType,
          slots: r.availableSlots,
          price: `P${Number(r.rentalPrice).toLocaleString()}`,
          aircon: r.aircon ? "Air-conditioned" : "Non-aircon",
          furnished: r.furnished ? "Furnished" : "Unfurnished",
          amenities: r.amenities || "N/A"
        }))
      };
    });

    return {
      totalHouses: houseList.length,
      totalRoomsAvailable: activeRooms.reduce((acc, r) => acc + (r.availableSlots || 1), 0),
      houses: houseList,
      lastUpdated: new Date().toISOString()
    };
  } catch (err) {
    console.error("Error fetching live DB context for Dormigo:", err);
    return { totalHouses: 0, totalRoomsAvailable: 0, houses: [], lastUpdated: new Date().toISOString() };
  }
}

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenAI({ apiKey });
}

function buildSystemPrompt(dbContext) {
  const housesSummary = dbContext.houses.length > 0
    ? dbContext.houses.map((h, i) =>
        `${i + 1}. "${h.name}" (Barangay: ${h.barangay})\n   Address: ${h.address}\n   Contact: ${h.contact} | GCash: ${h.gcash}\n   Price: ${h.priceDisplay}\n   Available Rooms: ${h.roomsCount}\n   Room Details: ${h.rooms.length > 0 ? h.rooms.map(r => `${r.type} - ${r.price} - ${r.aircon} - ${r.furnished} - Slots: ${r.slots}`).join("; ") : "Contact owner for room details"}`
      ).join("\n\n")
    : "No boarding houses are currently registered in the system.";

  const ts = new Date(dbContext.lastUpdated).toLocaleString("en-PH", { timeZone: "Asia/Manila" });

  return `You are Dormigo, an intelligent, friendly, and conversational AI assistant built for DorMap — the official GIS-powered Boarding House Management & Mapping Platform of the Municipality of Bongabong, Oriental Mindoro, Philippines.

=== YOUR PERSONALITY & CHAT BEHAVIOR ===
1. NATURAL AI CONVERSATION (VERY IMPORTANT):
   - You act like a real, helpful conversational AI (similar to ChatGPT / Gemini).
   - NEVER refuse to chat or say you can only talk about dorms.
   - You can happily talk about general topics: greetings ("magandang gabi", "kumusta", "hi", "good morning"), casual conversations, daily life, study tips, weather, encouragement, and general questions.
   - If the user just greets you or makes casual talk, respond warmly, politely, and naturally like a true companion. You may also gently mention that you can help them anytime with boarding houses in Bongabong.

2. SYSTEM & REAL-TIME DATA EXPERT (DORMAP):
   - Whenever the user asks about boarding houses, dorms, rooms, bed spaces, rental prices, landlords, contacts, locations, or regulations in Bongabong, you MUST consult the LIVE DATABASE below and give accurate, real-time facts.
   - Quote exact boarding house names, addresses, room prices, available slots, and contact info from the database.
   - Never make up dorms or prices that do not exist in the database.
   - If a requested barangay has no registered dorms yet, mention it politely and recommend searching nearby barangays (like Poblacion or Labasan).

3. LANGUAGE RULES:
   - Match the user's language naturally:
     * If Tagalog/Filipino: respond in natural, friendly Tagalog/Filipino.
     * If English: respond in clear, fluent English.
     * If Taglish: respond in natural Filipino/Taglish.
   - Be warm, respectful, concise, and helpful. Use markdown bullet points and bold text for readability.

=== LIVE DATABASE CONTEXT (As of ${ts}) ===
Total Verified Boarding Houses: ${dbContext.totalHouses}
Total Available Room Slots: ${dbContext.totalRoomsAvailable}

Registered Boarding Houses:
${housesSummary}

=== DORMAP & BONGABONG MUNICIPAL CONTEXT ===
- Municipality: Bongabong, Oriental Mindoro, Philippines
- Office: Business Permit & Licensing Office (BPLO), 2F Municipal Building, Poblacion, Bongabong
- Contact: bplo@bongabong.gov.ph | (043) 283-5000
- Schools nearby:
  * Mindoro State University (MinSU - Bongabong Campus)
  * Bongabong National High School (BNHS)
  * Eastern Mindoro College (EMC)
  * TESDA Bongabong
  * St. Joseph Academy
- BPLO Verification Requirements: Mayor's Business Permit, BFP Fire Safety Inspection Certificate, Sanitary Permit, Barangay Clearance.
- Payments: GCash (automated via PayMongo) and Cash payments with digital receipts.

=== RESPONSE FORMAT ===
At the very end of every response, you MUST append this metadata block:
<DORMIGO_META>
{"suggestions":["Quick question 1","Quick question 2","Quick question 3"],"actionCards":[{"title":"Card Title","link":"/#map","label":"Button Label","icon":"map"}]}
</DORMIGO_META>

Rules for DORMIGO_META:
- Keep suggestions short and relevant to the context of the conversation.
- If the chat is casual/greeting, offer suggestions that introduce DorMap features (e.g. "Available dorms sa Poblacion", "Magkano ang pinakamura?", "Paano magbayad sa GCash?").
- Available Lucide icons: map, search, map-pin, credit-card, shield-check, user-plus, log-in, home, phone, building-2.
- Only include 1-2 action cards when relevant (e.g., link to "/#map" to view the map).`;
}

function parseGeminiResponse(rawText) {
  let reply = rawText || "";
  let suggestions = [];
  let actionCards = [];

  const metaMatch = reply.match(/<DORMIGO_META>([\s\S]*?)<\/DORMIGO_META>/);
  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1].trim());
      suggestions = Array.isArray(meta.suggestions) ? meta.suggestions : [];
      actionCards = Array.isArray(meta.actionCards) ? meta.actionCards : [];
    } catch (e) { /* parse failed, use defaults */ }
    reply = reply.replace(/<DORMIGO_META>[\s\S]*?<\/DORMIGO_META>/g, "").trim();
  }

  if (suggestions.length === 0) {
    suggestions = [
      "Available dorms sa Bongabong",
      "Pinakamurang boarding house",
      "Paano magbayad via GCash?",
      "View interactive map"
    ];
  }

  return { reply, suggestions, actionCards };
}

function fallbackResponse(message, dbContext) {
  const q = (message || "").trim().toLowerCase();
  const isGreeting = /\b(hi|hello|kamusta|kumusta|magandang (araw|hapon|gabi|umaga)|hey|uy|musta)\b/i.test(q);
  const isTagalog = /\b(saan|ano|paano|magkano|meron|mayroon|mga|bakante|kwarto|renta|bayad|tulong|kamusta|kumusta|mura|presyo|alin|nasaan|sino|bakit|gusto|kailangan|puwede|pwede|opo|po|salamat|dito|yung|namin|walang|bayan|maganda)\b/i.test(q);

  let reply, suggestions = [], actionCards = [];

  if (isGreeting) {
    if (isTagalog || /magandang|kumusta|kamusta/.test(q)) {
      reply = `Magandang araw/gabi sa iyo! Kumusta ka?\n\nAko si **Dormigo**, ang AI companion mo dito sa **DorMap Bongabong**. Handa akong makipag-chat sa iyo o tulungan kang maghanap ng verified na boarding house sa bayan.\n\nMay maitutulong ba ako sa iyo ngayon?`;
      suggestions = ["Available dorms sa Bongabong", "Pinakamurang boarding house", "Saan malapit sa MinSU?", "Tingnan ang mapa"];
    } else {
      reply = `Hello there! How are you doing today?\n\nI am **Dormigo**, your friendly AI companion for **DorMap Bongabong**. I'm here to chat, answer questions, or help you find verified boarding houses and dorms in Bongabong!\n\nWhat can I do for you today?`;
      suggestions = ["Available dorms in Bongabong", "Budget boarding houses", "How to pay via GCash?", "View Interactive Map"];
    }
    actionCards.push({ title: "Interactive Map", link: "/#map", label: "View Map", icon: "map" });
  } else if (/magkano|presyo|price|rent|budget|mura|cheap/i.test(q)) {
    reply = `Tungkol sa renta sa Bongabong: Sa kasalukuyan, mayroon tayong **${dbContext.totalHouses} verified boarding house(s)** sa system na may **${dbContext.totalRoomsAvailable} available slot(s)**.\n\nPwede mong i-filter ang mga dorm sa ating interactive map para makita ang pasok sa iyong budget!`;
    suggestions = ["Pinakamurang boarding house", "Dorms malapit sa MinSU", "Dorms sa Poblacion"];
    actionCards.push({ title: "View Map", link: "/#map", label: "Tingnan sa Mapa", icon: "map" });
  } else {
    if (isTagalog) {
      reply = `Kumusta! Naintindihan ko ang iyong mensahe. Bilang iyong AI assistant sa DorMap Bongabong, kasalukuyan tayong may **${dbContext.totalHouses} verified boarding houses** at **${dbContext.totalRoomsAvailable} available slots**.\n\nPwede kang magtanong tungkol sa mga dorm, presyo, lokasyon, o mag-chat tungkol sa ibang bagay!`;
      suggestions = ["Available dorms sa Poblacion", "Pinakamurang boarding house", "Paano magbayad via GCash?"];
    } else {
      reply = `Hello! I understand your message. As your AI assistant for DorMap Bongabong, we currently have **${dbContext.totalHouses} verified boarding houses** and **${dbContext.totalRoomsAvailable} available slots**.\n\nFeel free to ask about dorms, locations, prices, or anything else you'd like to chat about!`;
      suggestions = ["Available dorms in Bongabong", "Budget boarding houses", "Explore Interactive Map"];
    }
    actionCards.push({ title: "Explore Map", link: "/#map", label: "View Interactive Map", icon: "map" });
  }

  return { reply, suggestions, actionCards };
}

export async function processDormigoChat({ message, userContext = {}, history = [] }) {
  const dbContext = await fetchLiveDatabaseContext();
  const systemPrompt = buildSystemPrompt(dbContext);
  const ai = getAiClient();

  try {
    const conversationContents = [];

    if (Array.isArray(history) && history.length > 0) {
      for (const turn of history.slice(-8)) {
        if (turn.role === "user") {
          conversationContents.push({ role: "user", parts: [{ text: turn.content }] });
        } else if (turn.role === "assistant" || turn.role === "model") {
          conversationContents.push({ role: "model", parts: [{ text: turn.content }] });
        }
      }
    }

    conversationContents.push({ role: "user", parts: [{ text: message }] });

    // Reliable active Gemini models (fastest & highest availability first)
    const modelsToTry = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-flash-latest"];
    let rawText = "";

    for (const model of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: conversationContents,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.7,
            maxOutputTokens: 1024,
            topP: 0.9
          }
        });
        rawText = response.text || "";
        if (rawText) break;
      } catch (modelErr) {
        console.warn(`[Dormigo] Model ${model} failed, trying next...`, modelErr?.message || modelErr);
      }
    }

    if (!rawText) {
      throw new Error("No response generated from Gemini models");
    }

    const { reply, suggestions, actionCards } = parseGeminiResponse(rawText);
    return { reply, suggestions, actionCards };

  } catch (err) {
    console.error("[Dormigo Gemini Error]", err?.message || err);
    return fallbackResponse(message, dbContext);
  }
}

export default {
  processDormigoChat,
  fetchLiveDatabaseContext,
  SYSTEM_KNOWLEDGE
};
