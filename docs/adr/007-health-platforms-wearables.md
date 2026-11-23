# ADR 007: Apple Health and Health Connect at the store launch, watch APIs later

- Status: accepted
- Date: 2026-11-23
- Amends: BLUEPRINT §3 (feature map), §7 (stages) and §8 (safety); ADR 003 (its consequence "HealthKit /
  Health Connect import stays in E10")

## Context

While reviewing spec 011 (daily check-in), the human asked (2026-11-23) to connect the app with Apple
Health on iOS, its Android counterpart, and smartwatches (Apple Watch, Garmin Connect and other brands), so
that the metrics are more accurate than what a user types.

The blueprint had all of it in E10 ("HealthKit / Health Connect import, wearables"), after the launch.
Spec 011 already prepares the ground: sleep is stored in minutes and `daily_checkins.source` reserves
`health_import`.

What was checked on 2026-11-23:

- **Apple Watch has no API of its own for this.** It writes sleep, heart rate, HRV and workouts to
  Apple Health, so reading HealthKit covers it.
- **Many other brands sync to the platform stores** (Samsung, Fitbit / Pixel, Withings, Oura and
  others). Garmin, Polar and Suunto send only part of their data there, and which part depends on the
  brand and the data type; it has to be checked brand by brand.
- **Reading the platform stores needs native modules** (`@kingstinct/react-native-healthkit` for iOS,
  `react-native-health-connect` for Android, each with an Expo config plugin). They do not run in Expo Go
  or on the web: they need a development build.
- **Both stores review health access.** Google Play asks for the health apps declaration with a
  justification for every Health Connect data type, and the privacy policy must match. Apple needs the
  HealthKit entitlement and applies its App Review rules on health data (no advertising use, no storage
  in iCloud).
- **Direct watch APIs are gated.** Garmin's Health and Activity APIs need an application and approval,
  and Garmin reportedly paused new access requests (developer forum and press, September 2026). An
  aggregator (Terra, Junction, Rook) covers many brands with one integration, but it is a new vendor that
  processes health data, with a per-user cost.

## Decision

1. **Two layers.**
   - **Layer 1, platform stores: Apple Health (HealthKit) on iOS and Health Connect on Android.** It
     ships with the store apps in **E9**, because it exists only in the native builds. It reads; it never
     writes in this layer.
   - **Layer 2, watch APIs: Garmin and other brands directly, or one aggregator.** It stays in **E10**.
     Its own ADR chooses between direct APIs and an aggregator, from what layer 1 already covers (how
     many users have a watch whose data does not reach the stores), Garmin's access status, cost and the
     DPA. It is the only path that also works on the web.
2. **Every imported datum changes something visible** (principle 7). Layer 1 reads only:
   - **Sleep** → prefills the daily check-in (spec 011). It stays editable, and a value the user types
     wins over the imported one for that day.
   - **Weight** (smart scales) → the weight log (spec 003), marked as imported.
   - **Workouts** → imported as workouts with their minutes and kind, never duplicating a workout the
     user already logged by hand (matched by external id and overlapping time).
   - **Resting heart rate and HRV** are read only once the professional reviewer has set readiness rules
     for them; until then they are not requested.
   - **Steps and active energy are not read.** `targets-v2` already counts the job activity and the
     planned training; adding them would count exercise twice (ADR 003). The weekly review (E5b) may ask
     for them later through its own spec.
3. **Free.** Layer 1 has no per-user cost and is an input method, so it is free. The tier of layer 2 is
   decided in its ADR (an aggregator's per-user cost may make it Premium).
4. **The manual input stays enough on its own** (ADR 003). The web, Expo Go and users without a watch
   lose nothing: every imported datum can be entered by hand, and the app never requires a connection.
5. **Imported data is minimised.** Only the types listed above, only the days the feature needs (the
   E9 spec sets the window), read on the device and sent to `apps/api` like any manual entry. Imported
   data reaches an AI prompt only through the context slice of a feature that needs it (BLUEPRINT §4).
6. **Start the Garmin application now** (lead time), and watch its pause; the store requirements of
   layer 1 are part of E9.

## Consequences

- E9 grows: two native modules, development builds, the Play Console health declaration, the HealthKit
  entitlement and its review, and a privacy policy that lists the health data read.
- Once the native modules land, Expo Go no longer runs every feature: the import screens need a
  platform file (`.native.tsx` / `.web.tsx`) with a "not available here" state, and phone checks of
  those screens use an EAS development build. E5b already needs a development build for voice messages.
- Reading the stores is a new data category: the consent text names it per data type, `CONSENT_VERSION`
  changes and consent is asked again; export and deletion cover the imported rows, and disconnecting
  stops reading without deleting what was imported unless the user asks.
- Tables that receive imported rows need a source (`daily_checkins.source` exists; `body_measurements`
  and `workouts` gain one in the E9 spec).
- Readiness may later use heart rate and HRV: new thresholds for the professional review.
- Layer 2 may add a service to BLUEPRINT §1 (an aggregator); layer 1 adds none.
- Stage IDs and order do not change: E5c → E5b → beta → E7 → E6 → E8 → E9 → E10.
