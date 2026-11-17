# ADR 004: Touch first, AI where it is faster, chat for questions, voice messages

- Status: accepted
- Date: 2026-11-12
- Supersedes: ADR 002 decision 2 (AI-first input) and ADR 003 decision 2 (hybrid onboarding)

## Context

ADR 002 made natural language the default way to enter data, with forms as the fallback. In the first
human test of the onboarding (2026-11-12) the form worked well and the demo chat collected the data badly.
The human then decided that basic data entry should use forms and taps, which are faster and simpler,
that the chat should answer questions about the recommendations, and that it should accept voice messages.

Two facts were checked on 2026-11-12. The Claude Messages API takes text, images and PDFs but no audio,
so a voice message must be transcribed before it reaches Claude. Expo SDK 58 records audio with
`expo-audio` (Expo Go and web included) and has no first-party speech-to-text module.

## Decision

1. **Touch first.** Structured data is entered with taps and forms: profile, goals, typical week, daily
   check-in, sets and reps, food search, recents, favourites and barcode. This is the primary path of
   every feature.
2. **AI where it is faster.** A plate or label photo, and a typed or spoken sentence for a meal or a
   session, are secondary inputs. They always produce an editable draft. The AI keeps doing the work
   behind the screen: matching foods, building plans and programs, explaining.
3. **Onboarding is a form.** The form becomes the onboarding entry now (spec 001). The conversational
   onboarding is no longer linked from the UI and is retired in E2b instead of being reworked into the
   hybrid flow of ADR 003.
4. **The chat is for questions.** A scoped assistant ships in the beta (E5b). It answers questions about
   the user's targets, today's session and the weekly adjustments from the user context and the knowledge
   base, with citations and a daily cap. The full coach (plans, programs, open coaching) stays in E7.
5. **Voice messages in the chat, transcribed on the device.** The app records the message, the phone
   transcribes it to text, the user sees the transcript, and only the text reaches Claude. There is no
   new vendor, and the audio is never uploaded or stored. Keyboard dictation keeps working in every text
   field.

## Consequences

- Blueprint principle 2, the feature map, the CLAUDE.md conventions and the `ui-screen` skill change from
  "AI-first input" to "touch first". The product is still built around AI; the change is about who types.
- The onboarding prompt, its tool schema, its evals and the mock chat are not reworked for `targets-v2`.
  The chat UI, the tool loop, the metering and the rate limits are reused by the questions assistant.
- The eating-disorder soft stop was raised by the onboarding chat (spec 001 AC20). With a form-only
  onboarding nothing raises it until the questions assistant exists, so that assistant must raise the
  same safety flags. The rules in `core` that do not depend on it (calorie floor, low BMI, minors) are
  unaffected.
- The typical week (ADR 003, E5) is edited on a week grid with taps. A one-sentence shortcut is optional.
- The beta grows. The questions assistant needs a prompt, tools over the context snapshot, citations,
  evals, safety rules and a cost cap, and a first slice of the text knowledge it cites moves from E7 to
  E5b.
- On-device transcription needs a native speech-recognition module, so voice messages need a development
  build and do not work in Expo Go. Its web support and its accuracy in Spanish are unverified: the E5b
  spec must check them, and where recognition is unavailable the microphone button is hidden and keyboard
  dictation remains.
- A speech-to-text provider (works in Expo Go and on the web, but is one more vendor, with a cost per
  minute and a DPA that must cover voice and health data) was the alternative. It stays as the fallback
  if on-device quality is not good enough, and choosing it needs a new ADR.
