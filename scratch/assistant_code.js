app.post("/api/assistant/message", async (req, res) => {
  try {
    // `location` no longer defaults to "Sehore, MP". That default was
    // interpolated straight into the model prompt, so somebody in Kerala was
    // told about a district in Madhya Pradesh in a confident voice. With no
    // location the answer is simply not location-specific, which is the
    // honest form of not knowing where a person is.
    const {
      message,
      language = "English",
      userProfile = EMPTY_PROFILE,
      location = null,
      lat = null,
      lng = null,
      conversationHistory = [],
    } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message string is required" });
    }

    const trimmed = message.trim();
    const lower = trimmed.toLowerCase();
    const isHindi = language.toLowerCase().includes("hi") || /[ऀ-ॿ]/.test(trimmed);

    // Coordinates decide whether hospitals can be named at all. No
    // coordinates means no hospital list plus a sentence saying why — never
    // a substituted village centroid or district headquarters.
    const userLat = lat === null || lat === "" || !Number.isFinite(Number(lat)) ? null : Number(lat);
    const userLng = lng === null || lng === "" || !Number.isFinite(Number(lng)) ? null : Number(lng);
    const locationShared = userLat !== null && userLng !== null;

    // Critical Emergency Safety Rules (Bypasses LLM latency if critical)
    const criticalEmergencyPatterns = [
      "chest pain", "heart attack", "can't breathe", "cannot breathe", "choking",
      "heavy bleeding", "profuse bleeding", "unconscious", "fainted", "snake bite",
      "poison", "severe burn", "head injury", "सीने में दर्द", "सांस नहीं आ रही",
      "बेहोश", "सांप ने काटा", "जहर", "खून बह रहा"
    ];

    const isEmergency = criticalEmergencyPatterns.some(pat => lower.includes(pat));

    if (isEmergency) {
      // This branch used to fabricate an emergency record: a patient name, an
      // ASHA worker called "Radha Bai" who does not exist, and
      // n8n_dispatched: true — an assertion that an ambulance workflow had
      // fired. Nothing was dispatched and nobody was notified. Telling a
      // person mid-emergency that help is already on the way, when no message
      // left the building, was the most dangerous line in this file.
      //
      // Now: the guidance is immediate and unchanged, the hospitals come from
      // the registry, and the only thing said about an ASHA worker is a
      // pointer to the SOS flow that can actually reach one and that reports
      // back who it reached. See server/routes/sos.ts.
      const hospitals = await nearestHospitals(userLat, userLng, 3, 50);

      return res.json(assistantReply({
        intent: "emergency",
        isHindi,
        urgency: "emergency",
        entities: { symptoms: [trimmed], urgency_level: "immediate_call" },
        response: isHindi
          ? "⚠️ तुरंत 108 या 112 पर एम्बुलेंस बुलाएँ। यह आपातकालीन स्थिति हो सकती है। शांत रहें, मरीज़ को आराम से लिटाएँ और निकटतम अस्पताल पहुँचें। परिजनों और आशा कार्यकर्ता तक ख़बर पहुँचाने के लिए 'आपातकालीन SOS' भेजें — भेजने के बाद आपको दिखेगा कि सूचना किस-किस तक पहुँची।"
          : "⚠️ Call 108 or 112 for an ambulance now. This may be a medical emergency. Keep the patient calm and resting, and reach the nearest hospital. To reach your family contacts and your ASHA worker, send an Emergency SOS — after sending, you will see exactly who it reached.",
        summary: {
          documentsRequired: isHindi
            ? ["दस्तावेज़ न होने पर भी आपातकालीन इलाज से मना नहीं किया जा सकता", "पास में हों तो आयुष्मान कार्ड और आधार साथ ले जाएँ"]
            : ["Emergency treatment cannot be refused for want of documents", "Carry the Ayushman card and Aadhaar only if they are already within reach"],
          nextSteps: isHindi
            ? ["108 या 112 पर कॉल करें", "आपातकालीन SOS भेजें", "निकटतम सूचीबद्ध अस्पताल पहुँचें"]
            : ["Call 108 or 112 now", "Send an Emergency SOS", "Reach the nearest listed hospital"],
          healthGuidance: isHindi
            ? ["मरीज़ को बिना ज़रूरत हिलाएँ-डुलाएँ नहीं", "खाने-पीने को कुछ न दें", "साँस और होश पर नज़र रखें"]
            : ["Do not move the patient unnecessarily", "Do not give anything to eat or drink", "Keep watching their breathing and alertness"],
        },
        hospitals,
        locationShared,
        actions: [
          { type: "call_emergency", label: "Call 108 Ambulance", number: "108" },
          { type: "call_emergency", label: "Call 112 All Emergencies", number: "112" },
          { type: "broadcast_sos", label: isHindi ? "आपातकालीन SOS भेजें" : "Send Emergency SOS", link: "/emergency" },
          { type: "find_care", label: isHindi ? "निकटतम अस्पताल" : "Nearest Hospital", link: "/care" }
        ],
        sourceType: "curated",
        sources: ["National Emergency Medical Guidelines", "MoHFW Emergency Triage"],
        confidence: 0.99,
      }));
    }

    const systemInstruction = `
You are Sehat Sathi (सेहत साथी), a compassionate, verified AI Rural Health and Government Health Scheme Assistant built for rural and semi-urban India.
Tone: Respectful, very clear, jargon-free, supportive, culturally sensitive.
Key direct directives:
1. NO MEDICINE PRESCRIPTIONS: You must NEVER prescribe, suggest, or recommend any specific medicines, drugs, or dosages. You may ONLY provide home-level comfort remedies (e.g., resting, hydration, cold compresses) and general lifestyle guidance.
2. ACT LIKE A DOCTOR AT A CLINIC: If the user describes a new non-emergency health issue, DO NOT immediately give solutions. FIRST ask 1 to 3 major clarifying questions to understand their condition (e.g., "How long have you had it?", "Are there other symptoms?"). Do not ask more than 3 questions.
3. DETECT EMERGENCIES: If the user describes a highly serious health issue (e.g., heart attack, severe chest pain, snake bite, major accident, heavy bleeding, stroke, loss of consciousness, poisoning, severe breathing issues):
   - Set "urgency" to "emergency".
   - Tell the user to call 108 immediately.
   - Include an action chip in the "actions" array: { "type": "call_emergency", "label": "Call 108 Ambulance", "link": "tel:108" }.
4. Only after gathering context for non-emergencies should you provide safe, verified first-step guidance, and remind users that this does NOT replace a registered medical practitioner.
5. If the user asks about health schemes, clearly explain benefits, eligibility, and required documents.
6. Output MUST be valid JSON adhering to the specified schema.
7. LANGUAGE MATCHING: You MUST strictly reply in the EXACT same language that the user used in their question. If they speak Hindi, reply in Hindi. If they speak English, reply in English.
`;

    // Conversation history and profile facts are passed only when they are
    // real. A "Ration Card: BPL" default used to be interpolated here, which
    // fed the model an entitlement claim about somebody it knew nothing
    // about, and the model then repeated it back as established fact.
    const contextLines = [
      userProfile?.name ? `- Name: ${userProfile.name}` : null,
      userProfile?.district ? `- District: ${userProfile.district}` : null,
      userProfile?.village ? `- Village: ${userProfile.village}` : null,
      userProfile?.ration_card_type ? `- Ration card: ${userProfile.ration_card_type}` : null,
      location ? `- Stated location: ${location}` : null,
      locationShared
        ? "- The user has shared GPS coordinates, so a real hospital list is attached to this answer by the server."
        : "- The user has NOT shared a location. Do not name any specific facility, town or district.",
    ].filter(Boolean).join("\n");

    const recentTurns = (Array.isArray(conversationHistory) ? conversationHistory : [])
      .slice(-6)
      .map((turn: any) => `${turn?.role === "assistant" ? "Assistant" : "User"}: ${String(turn?.content ?? turn?.text ?? "").slice(0, 500)}`)
      .join("\n");

    const prompt = `
User Question: "${trimmed}"

What is actually known about this user:
${contextLines}
${recentTurns ? `\nEarlier in this conversation:\n${recentTurns}\n` : ""}
Instructions:
1. Answer empathetically and clearly. You MUST reply in the EXACT same language as the User Question.
2. Suggest 1-2 applicable Government Health Schemes relevant to the concern (Ayushman Bharat PM-JAY, Janani Suraksha Yojana, PM Matru Vandana, Jan Aushadhi, Nikshay Poshan, RBSK and so on), with what the scheme gives and who it is for.
3. Phrase every eligibility statement as a possibility to be checked, never as a decision — "you may be eligible based on the information available", not "you are eligible".
4. Never invent a hospital, clinic, doctor, address or phone number. The server attaches the real facility list. Refer to it generally ("the nearest listed hospitals below") and say nothing about which facilities exist near this user.
5. Fill 'summary' with three lists the user can act on: 'documents_required' (papers to carry), 'next_steps' (what to do, in order) and 'health_guidance' (care and precautions until then). Three to five short items each. Write these lists in the EXACT same language as the User Question.
6. Include actionable chips in 'actions' linking to schemes (/schemes/<id>) and to the facility list (/care).
7. Populate 'related_schemes' with id, title, benefit_summary and link.

Respond with structured JSON adhering to the schema.
`;

    const candidateTextModels = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-2.5-flash"];
    const parsedResult = await callGeminiSafe(
      candidateTextModels,
      (gemini, model) =>
        gemini.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                intent: { type: Type.STRING },
                language: { type: Type.STRING },
                entities: {
                  type: Type.OBJECT,
                  properties: {
                    symptoms: { type: Type.ARRAY, items: { type: Type.STRING } },
                    scheme_topic: { type: Type.STRING },
                    facility_type: { type: Type.STRING },
                  },
                },
                urgency: { type: Type.STRING },
                response: { type: Type.STRING },
                // The written summary is required, not optional. Made
                // optional, the model omitted it on roughly half of short
                // questions, and the screen that promises a summary at the
                // end of every answer would then have nothing to show.
                summary: {
                  type: Type.OBJECT,
                  properties: {
                    documents_required: { type: Type.ARRAY, items: { type: Type.STRING } },
                    next_steps: { type: Type.ARRAY, items: { type: Type.STRING } },
                    health_guidance: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ["documents_required", "next_steps", "health_guidance"],
                },
                related_schemes: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      title: { type: Type.STRING },
                      benefit_summary: { type: Type.STRING },
                      link: { type: Type.STRING },
                    },
                    required: ["id", "title", "benefit_summary", "link"],
                  },
                },
                actions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      label: { type: Type.STRING },
                      link: { type: Type.STRING },
                      target_id: { type: Type.STRING },
                    },
                    required: ["type", "label"],
                  },
                },
                source_type: { type: Type.STRING },
                sources: { type: Type.ARRAY, items: { type: Type.STRING } },
                confidence: { type: Type.NUMBER },
              },
              required: ["intent", "language", "urgency", "response", "summary", "actions", "source_type", "sources"],
            },
          },
        }),
      (text) => JSON.parse(text)
    );

    if (parsedResult && parsedResult.response) {
      // The model answers in snake_case because that is what its schema
      // declares; the client contract is camelCase. Mapped here rather than
      // teaching the client two shapes. Hospitals are attached by the server,
      // never by the model — the model has no access to the registry and any
      // facility it named would be invented.
      const hospitals = await nearestHospitals(userLat, userLng, 3, 25);
      const modelSummary = parsedResult.summary ?? {};
      const asList = (value: unknown) =>
        Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.trim()) : [];

      return res.json(assistantReply({
        intent: parsedResult.intent || "health_guidance",
        isHindi: isHindi || String(parsedResult.language || "").toLowerCase().includes("hi"),
        urgency: parsedResult.urgency || "normal",
        entities: parsedResult.entities || {},
        response: parsedResult.response,
        summary: {
          documentsRequired: asList(modelSummary.documents_required),
          nextSteps: asList(modelSummary.next_steps),
          healthGuidance: asList(modelSummary.health_guidance),
        },
        relatedSchemes: (Array.isArray(parsedResult.related_schemes) ? parsedResult.related_schemes : [])
          .map((scheme: any) => ({
            id: scheme?.id,
            title: scheme?.title,
            benefitSummary: scheme?.benefit_summary,
            link: scheme?.link,
            benefit_summary: scheme?.benefit_summary, // alias, see assistantReply
          }))
          .filter((scheme: any) => scheme.id && scheme.title),
        hospitals,
        locationShared,
        actions: Array.isArray(parsedResult.actions) ? parsedResult.actions : [],
        sourceType: parsedResult.source_type || "model",
        sources: asList(parsedResult.sources),
        confidence: typeof parsedResult.confidence === "number" ? parsedResult.confidence : 0.8,
      }));
    }

    // Robust Rule-Based & Curated Fallback. `isHindi` is already resolved at
    // the top of the route; it used to be recomputed here.
    // Check if query is about schemes
    if (lower.includes("scheme") || lower.includes("ayushman") || lower.includes("pmjay") || lower.includes("card") || lower.includes("delivery") || lower.includes("योजना") || lower.includes("आयुष्मान") || lower.includes("पैसा")) {
      const hospitals = await nearestHospitals(userLat, userLng, 3, 25);
      return res.json(assistantReply({
        intent: "scheme_search",
        isHindi,
        urgency: "normal",
        entities: { scheme_topic: "Ayushman Bharat PM-JAY & Janani Suraksha" },
        response: isHindi
          ? "सरकारी स्वास्थ्य योजनाओं के तहत परिवार को कई लाभ मिल सकते हैं:\n1. आयुष्मान भारत (PM-JAY): पात्र परिवारों के लिए प्रति वर्ष ₹5 लाख तक का कैशलेस इलाज।\n2. जननी सुरक्षा योजना (JSY): संस्थागत प्रसव पर नकद सहायता।\n3. जन औषधि केंद्र: जेनेरिक दवाएं काफ़ी कम कीमत पर।\nराशन कार्ड और आधार लेकर निकटतम स्वास्थ्य केंद्र या CSC पर अपनी पात्रता जाँचवाएँ — पात्रता वहीं तय होती है, इस ऐप में नहीं।"
          : "Government health schemes can give your family substantial support:\n1. Ayushman Bharat PM-JAY: up to ₹5 lakh of cashless hospital care a year for eligible families.\n2. Janani Suraksha Yojana: cash assistance for an institutional delivery.\n3. Jan Aushadhi Kendras: the same medicines at a fraction of the price.\nTake your ration card and Aadhaar to the nearest health centre or CSC to have your eligibility checked — that check happens there, not in this app.",
        summary: {
          documentsRequired: isHindi
            ? ["आधार कार्ड (परिवार के हर सदस्य का)", "राशन कार्ड या SECC/पात्रता पर्ची", "मोबाइल नंबर", "पहले का इलाज हुआ हो तो पर्चे"]
            : ["Aadhaar card for each family member", "Ration card or SECC / entitlement slip", "A mobile number", "Earlier prescriptions or discharge papers, if any"],
          nextSteps: isHindi
            ? ["नज़दीकी CSC, आयुष्मान आरोग्य मंदिर या सूचीबद्ध अस्पताल के आयुष्मान मित्र काउंटर पर जाएँ", "अपना नाम लाभार्थी सूची में जाँचवाएँ", "आयुष्मान कार्ड मुफ़्त बनवाएँ — किसी को पैसे न दें", "गाँव की आशा कार्यकर्ता से मदद लें"]
            : ["Visit a CSC, an Ayushman Arogya Mandir, or the Ayushman Mitra desk at a listed hospital", "Ask them to check your name against the beneficiary list", "Have the Ayushman card made — it is free, pay nobody for it", "Ask your village ASHA worker to help with the paperwork"],
          healthGuidance: isHindi
            ? ["योजना का कार्ड बनने से पहले भी आपातकालीन इलाज नहीं रोका जा सकता", "इलाज से पहले अस्पताल से पूछें कि वह इस योजना में सूचीबद्ध है या नहीं"]
            : ["Emergency treatment cannot be withheld while a card is still being made", "Before treatment, ask the hospital directly whether it is empanelled under the scheme"],
        },
        relatedSchemes: [
          {
            id: "pmjay-ayushman",
            title: isHindi ? "आयुष्मान भारत (PM-JAY)" : "Ayushman Bharat (PM-JAY)",
            benefitSummary: isHindi ? "पात्र परिवारों के लिए सालाना ₹5 लाख तक कैशलेस इलाज" : "Up to ₹5 lakh of cashless hospital care a year for eligible families",
            benefit_summary: isHindi ? "पात्र परिवारों के लिए सालाना ₹5 लाख तक कैशलेस इलाज" : "Up to ₹5 lakh of cashless hospital care a year for eligible families",
            link: "/schemes/pmjay-ayushman"
          },
          {
            id: "janani-suraksha",
            title: isHindi ? "जननी सुरक्षा योजना (JSY)" : "Janani Suraksha Yojana (JSY)",
            benefitSummary: isHindi ? "संस्थागत प्रसव पर नकद सहायता" : "Cash assistance for an institutional delivery",
            benefit_summary: isHindi ? "संस्थागत प्रसव पर नकद सहायता" : "Cash assistance for an institutional delivery",
            link: "/schemes/janani-suraksha"
          }
        ],
        hospitals,
        locationShared,
        actions: [
          { type: "open_scheme", label: isHindi ? "आयुष्मान योजना देखें" : "View Ayushman Bharat", link: "/schemes/pmjay-ayushman" },
          { type: "open_scheme", label: isHindi ? "जननी सुरक्षा देखें" : "View Janani Suraksha", link: "/schemes/janani-suraksha" },
          { type: "find_care", label: isHindi ? "सूचीबद्ध अस्पताल खोजें" : "Find an empanelled hospital", link: "/care" },
          { type: "message_asha", label: isHindi ? "आशा कार्यकर्ता से पूछें" : "Ask your ASHA worker", link: "/messages" }
        ],
        sourceType: "curated",
        sources: ["National Health Authority (pmjay.gov.in)", "National Health Mission (nhm.gov.in)"],
        confidence: 0.96,
      }));
    }

    // Check if query is about finding a clinic, doctor or hospital
    if (lower.includes("doctor") || lower.includes("hospital") || lower.includes("clinic") || lower.includes("phc") || lower.includes("chc") || lower.includes("अस्पताल") || lower.includes("डॉक्टर") || lower.includes("दवा")) {
      // This used to answer "Sadar Community Health Centre is 1.8 km away,
      // call 07562-224411" to every user in the country. The centre, the
      // distance and the number were all written into the source. What
      // replaces them is the registry list, or an honest blank.
      const hospitals = await nearestHospitals(userLat, userLng, 5, 25);
      const found = hospitals.hospitals.length;

      return res.json(assistantReply({
        intent: "find_care",
        isHindi,
        urgency: "normal",
        entities: { facility_type: "Empanelled hospital / Primary Health Centre" },
        response: found > 0
          ? (isHindi
            ? `आपके स्थान के आसपास ${found} सूचीबद्ध अस्पताल मिले — नीचे दूरी, पता और फ़ोन नंबर के साथ दिए गए हैं। जाने से पहले फ़ोन करके पुष्टि कर लें कि जिस विभाग की ज़रूरत है वह आज खुला है। सरकारी प्राथमिक स्वास्थ्य केंद्र (PHC) और आयुष्मान आरोग्य मंदिर में आवश्यक दवाएं और बुनियादी जाँचें मुफ़्त मिलती हैं।`
            : `There are ${found} listed hospitals near your location, shown below with distance, address and phone number. Ring ahead to confirm the department you need is open today. Government PHCs and Ayushman Arogya Mandirs provide essential medicines and basic tests free of charge.`)
          : (isHindi
            ? "अस्पतालों की सूची आपके स्थान के आधार पर बनती है। स्थान की अनुमति देने पर सूचीबद्ध अस्पताल दूरी के क्रम में दिखेंगे। तब तक: सरकारी PHC और आयुष्मान आरोग्य मंदिर में आवश्यक दवाएं और बुनियादी जाँचें मुफ़्त मिलती हैं, और आपकी आशा कार्यकर्ता बता सकती हैं कि गाँव के लिए कौन सा केंद्र तय है।"
            : "The hospital list is built from your location. Allow location access and the listed hospitals will appear in order of distance. Meanwhile: government PHCs and Ayushman Arogya Mandirs provide essential medicines and basic tests free of charge, and your ASHA worker can tell you which centre your village is attached to."),
        summary: {
          documentsRequired: isHindi
            ? ["आधार कार्ड", "आयुष्मान कार्ड, यदि बना हो", "पहले के पर्चे और जाँच रिपोर्ट"]
            : ["Aadhaar card", "Ayushman card, if you have one", "Earlier prescriptions and test reports"],
          nextSteps: isHindi
            ? ["जाने से पहले अस्पताल को फ़ोन करके OPD का समय पूछें", "आयुष्मान के तहत इलाज चाहिए तो आयुष्मान मित्र काउंटर पर जाएँ", "आपात स्थिति में 108 पर एम्बुलेंस बुलाएँ, इंतज़ार न करें"]
            : ["Phone the hospital before travelling and ask its OPD hours", "For treatment under Ayushman Bharat, go to the Ayushman Mitra desk", "In an emergency call 108 for an ambulance rather than travelling on your own"],
          healthGuidance: isHindi
            ? ["सभी पुरानी रिपोर्ट एक फ़ाइल में साथ रखें", "जो दवाएं चल रही हैं उनके नाम लिखकर ले जाएँ"]
            : ["Keep all past reports together in one folder", "Write down the names of medicines you are already taking and carry the list"],
        },
        hospitals,
        locationShared,
        actions: [
          { type: "find_care", label: isHindi ? "सभी नज़दीकी अस्पताल देखें" : "See all nearby hospitals", link: "/care" },
          { type: "message_asha", label: isHindi ? "आशा कार्यकर्ता से पूछें" : "Ask your ASHA worker", link: "/messages" }
        ],
        sourceType: "registry",
        sources: ["National Health Authority PM-JAY empanelled hospital registry"],
        confidence: found > 0 ? 0.95 : 0.6,
      }));
    }

    // General Health Guidance Fallback
    return res.json(assistantReply({
      intent: "health_guidance",
      isHindi,
      urgency: "normal",
      entities: { symptoms: [trimmed] },
      response: isHindi
        ? `आपकी बात "${trimmed}" के लिए प्राथमिक सलाह:\n1. पर्याप्त आराम करें और उबाला हुआ गुनगुना पानी पिएँ।\n2. डॉक्टर या स्वास्थ्य कर्मी की सलाह के बिना एंटीबायोटिक या तेज़ दवा न लें।\n3. लक्षण दो दिन से ज़्यादा बने रहें, बिगड़ें, या तेज़ बुखार और कमज़ोरी हो तो निकटतम प्राथमिक स्वास्थ्य केंद्र जाएँ या अपनी आशा कार्यकर्ता से बात करें।`
        : `First-step guidance about "${trimmed}":\n1. Rest properly and drink plenty of clean, boiled water, warm rather than cold.\n2. Do not take antibiotics or strong medicines without a doctor or health worker advising them.\n3. If it lasts more than two days, gets worse, or comes with a high fever or weakness, go to your nearest Primary Health Centre or speak to your ASHA worker.`,
      summary: {
        documentsRequired: isHindi
          ? ["आधार कार्ड", "जो दवाएं चल रही हैं उनकी सूची या पुराने पर्चे"]
          : ["Aadhaar card", "A list of medicines you are already taking, or your old prescriptions"],
        nextSteps: isHindi
          ? ["दो दिन लक्षणों पर नज़र रखें और लिखते जाएँ", "आराम न मिले तो PHC की OPD में दिखाएँ", "गाँव की आशा कार्यकर्ता को बताएँ — वे नज़दीकी केंद्र और शिविर की जानकारी दे सकती हैं"]
          : ["Watch the symptoms for two days and write down what changes", "If there is no relief, attend the OPD at your PHC", "Tell your village ASHA worker — she can point you to the right centre or an upcoming camp"],
        healthGuidance: isHindi
          ? ["साफ़ पानी और ताज़ा बना खाना लें", "हाथ धोने का ध्यान रखें", "बुखार हो तो शरीर में पानी की कमी न होने दें"]
          : ["Stick to clean water and freshly cooked food", "Wash hands carefully", "If there is a fever, keep up fluids so they do not become dehydrated"],
      },
      hospitals: undefined,
      locationShared,
      actions: [
        { type: "find_care", label: isHindi ? "पास का अस्पताल खोजें" : "Find a hospital nearby", link: "/care" },
        { type: "open_scheme", label: isHindi ? "सरकारी योजनाएं देखें" : "Explore health schemes", link: "/schemes" },
        { type: "message_asha", label: isHindi ? "आशा कार्यकर्ता को संदेश भेजें" : "Message your ASHA worker", link: "/messages" }
      ],
      sourceType: "curated",
      sources: ["National Health Mission primary care guidelines", "WHO rural health protocols"],
      confidence: 0.92,
    }));
  } catch (error) {
    console.error("Error in /api/assistant/message:", error);
    res.status(500).json({ error: "Failed to process health guidance request" });
  }
});

// 2. POST /api/voice/transcribe - Bhashini / Speech Transcription Endpoint

