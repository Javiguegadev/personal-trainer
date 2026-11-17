# ADR 006: A week view in E5 and manual planning of meals and sessions before the beta

- Status: accepted
- Date: 2026-11-16
- Amends: BLUEPRINT §3 (feature map), §5 (plans) and §7 (stages)

## Context

After the food log of spec 005 the human asked (2026-11-16) for a weekly calendar: see the whole week at
a glance (meals, work and training), open any day, plan meals and sessions for the days ahead, and add
what was already done on a past day. Meals and sessions must also stay editable from their own sections.

The blueprint already had the pieces, in different stages: a "typical week" grid for work, sport and gym
slots in E5, and plans whose items have the shape of the logs in E7, where they are written by the AI.
Nothing let a user plan a day by hand, and the food log rejects future dates on purpose. Asked whether
manual planning should wait for E7, the human chose to have it **before the beta**.

## Decision

1. **Week view, in E5.** The week grid of E5 becomes a view of the real week, not only of the typical
   one: seven days with the work shift, the training planned and done, and the meals logged. Tapping a
   day opens its breakdown. It is a second view of the same data: the Food tab and the Training tab keep
   adding and editing meals and sessions, and the week view opens them on the chosen day.
2. **Manual planning, in a new stage E5c, after E5 and before E5b.** The user plans meals and sessions
   for the days ahead with taps (search, recents, favourites, "copy from another day"; templates and
   the exercise library for sessions). A planned meal or session is logged in one tap, and can be
   edited before logging.
3. **Planned and logged are stored apart.** A planned item is never a log row with a future date: the
   logs stay "what happened", so the eaten totals, the adherence and the weekly review never count a
   plan. Planned items live in the Plans block of §5, with the shape of the logs. The E5c spec defines
   the tables, and the AI plans of E7 write to the same ones, so there is one planner.
4. **Free and Premium.** Planning by hand is free. Generating a plan with AI stays in E7 (Premium, with a
   preview in Free), as an input shortcut that fills the same planner (ADR 004).
5. **Where it lives (to confirm in the E5 spec).** No sixth tab: Today gets a Day / Week switch. With
   Training, the tab bar has five tabs.

## Consequences

- The beta moves later by the size of E5c. In exchange the calendar is useful in the beta without any
  AI, and E7 only adds the generation.
- E5b gains an input: the weekly review can compare planned and done. That is for the E5b spec to
  decide; adherence to the targets does not depend on it.
- Safety rules of the food log apply to the planner and the week view: no numbers with `ed_soft_stop`,
  no judgement of a day (no red, no "bad day"), and allergies are checked when a plan proposes food
  (E7), not when the user chooses it by hand.
- Logging a past day already works for the last 7 days (spec 005). How far back the week view lets the
  user log is decided in the E5 spec, within the one-year limit of the write rules.
- Stage IDs keep their meaning; the order is E4 → E5 → E5c → E5b → beta → E7 → E6.
