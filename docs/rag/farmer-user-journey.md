# A Season with Amari — Farmer User Journey

A narrative walk-through of the PolisenseAI weather assistant from a farmer's
side of the screen. Amari is a persona, not a real user: a smallholder in
**Sapahar upazila, Naogaon district**, Bangladesh — the system's default
location — growing **Aman rice**, a small **mango** orchard, and a plot of
**eggplant**. The three crops and the one district match what the system
actually has data for; nothing in this guide asks the assistant something it
cannot answer for real.

Companion documents:

- [`farmer_weather_advisor_test_questions.md`](../farmer_weather_advisor_test_questions.md)
  — the same journey as a pass/fail test matrix. Each scene below names the
  question number(s) it dramatizes, so a failing test can be traced back to
  the moment in the journey it breaks.
- [`farmer-advisor-implementation.md`](farmer-advisor-implementation.md) — how
  the assistant behind these answers was built.

---

## Who Amari is

Amari has a smartphone, the GENIE.AI mobile app in Bengali, and about two
bighas of land split between a rice plot, a dozen mango trees planted by their
father, and a small eggplant bed near the house. Amari cannot check a
satellite map or a Copernicus bulletin directly — the app is the only way
these numbers reach them. What Amari asks is never phrased like a weather
report; it is always a decision waiting to be made.

## Setting the scene: 20 September, mid-Aman season

The Aman rice has been in the ground since July and is heading into the
reproductive stage. The monsoon usually starts tapering off around now. The
eggplant bed — this year's Kharif crop, sown back in May — is ready to
harvest, which is what makes Amari start wondering about the *next* one. This
is the week Amari opens the app to plan the next month, not just the next
day.

---

## Scene 1 — A quick check before breakfast

Amari does not start with a hard question. The app is opened the way a
farmer glances at the sky: to confirm what is already known.

> **Amari:** What are the months for Aman rice in Naogaon?
>
> **Assistant:** [lists the sowing, transplanting, and harvest months from the
> Aman rice crop calendar]

> **Amari:** What's today's date, and where are we in the rice season?
>
> **Assistant:** Today is Sunday, 20 September 2026 — the rice is in its
> [reproductive stage per the calendar], with harvest still [N] weeks away.

Nothing here surprises Amari. It confirms the app knows the same calendar
Amari's grandfather used, and that it knows today's date — the two facts
every later answer depends on.

*(Test questions 1, 3 — Stage 1, basic lookups.)*

## Scene 2 — Planning the next eggplant crop

The rice is already growing and needs no planting decision. The eggplant bed
does: it is ready for harvest, and Amari wants to know when to start the next
one. Amari has also heard the rains might end early this year.

> **Amari:** Is the rainy season late this year?
>
> **Assistant:** [compares the current seasonal outlook against the Aman
> calendar and states which baseline it is using — this year's forecast, not
> last year's rainfall, since the system has no rainfall history]

> **Amari:** When should I plant eggplant this year?
>
> **Assistant:** The calendar's Kharif eggplant window is May — and this
> year's has already passed; today the calendar puts your crop at the
> harvesting stage. [Does not invent a second, September planting window the
> document never described.]

> **Amari:** What should I do to get ready for next season's planting?
>
> **Assistant:** [practices drawn from the eggplant crop document — and says
> plainly if the document has nothing on a topic Amari asked about, instead
> of inventing advice]

*(Test questions 4, 5, 7 — Stage 2, deciding what to plant.)*

## Scene 3 — The week's work

Every few days, Amari checks the coming week before deciding what to do in
the field: irrigate, spray, or wait.

> **Amari:** Will it rain in my village this week?
>
> **Assistant:** [the 7-day forecast, day by day, with totals — the same
> numbers Amari would see on the forecast strip in the app]

> **Amari:** Should I irrigate my eggplant this week?
>
> **Assistant:** [reads the soil moisture band from the forecast — wet,
> moist, or dry — rather than a raw number Amari would have to interpret]

> **Amari:** Is this week's heat a problem for my mango trees?
>
> **Assistant:** [checks the forecast's maximum temperature against the
> mango-specific threshold, not a generic heat warning]

*(Test questions 8, 9, 10 — Stage 3, the week ahead.)*

## Scene 4 — Something looks wrong on the rice

Amari notices a few yellowing leaves on the rice and wants to rule out a
known problem before assuming it is the weather.

> **Amari:** What are the pests and diseases of Aman rice?
>
> **Assistant:** [the full list from the crop document, not just the two or
> three a shorter answer might have picked]

> **Amari:** Will this week's weather damage my rice?
>
> **Assistant:** [connects a specific forecast value — heavy rain, or a hot
> spell — to the rice crop's actual threshold, and says if nothing in the
> coming week crosses it]

*(Test questions 11, 12 — Stage 4, looking after the crop.)*

## Scene 5 — The bigger risks

Once a week, Amari asks about the things a bad answer could actually cost
money over: drought, flooding, and where the field boundaries actually are
for a subsidy application.

> **Amari:** Is there a drought risk in Naogaon next week?
>
> **Assistant:** [the stored drought assessment — built from satellite soil
> moisture and vegetation, not a guess from the forecast alone]

> **Amari:** Is my area at risk of flooding in the next ten days?
>
> **Assistant:** [the flood outlook for that specific horizon]

> **Amari:** Show me my field boundaries on the map.
>
> **Assistant:** [runs the field delineation job and returns the image —
> this one is a command, not a question, and the only map command in this
> release]

*(Test questions 13, 14, 15 — Stage 5, drought, flood, and field maps.)*

## Scene 6 — When the app says no

A neighbor mentioned potato prices are good this year. Amari asks the
assistant the same way as everything else.

> **Amari:** Is the weather good for planting potato here?
>
> **Assistant:** Potato does not have a crop profile in this system yet — I
> can answer for Aman rice, mango, or eggplant.

This is the answer the whole journey depends on: the app does not stretch a
document written for one crop to cover another it was never given.

*(Test question 16 — Stage 6, what the system must refuse.)*

---

## What Amari cannot do through the chat

- Ask about rainfall from last month, or any month before today — there is no
  observed rainfall history in the system, only the live forecast forward.
- Ask the assistant, mid-conversation, to notify them later — the chat has no
  memory between sessions and cannot set up an alert.
- Ask about a crop other than Aman rice, mango, or eggplant.
- Ask for the agromet bulletin or a flood map image inside the chat — the
  bulletin has no source file in this deployment, and the `flood` command
  does not render.

Push alerts for drought and flood warnings exist as a **separate app
feature** — Amari sets a district and crop once in the app settings, and the
warning engine broadcasts to registered devices when a threshold is crossed.
That is not something the chat itself does when asked; it is configured
outside the conversation.

## Why this order

Amari's questions get harder as the season goes on, and the guide follows
that: the first questions are things the app can only get right or wrong
(the calendar, today's date), the middle questions require combining two
sources and admitting when a baseline is missing, and the last ones test
whether the app knows what it was not given. A demo or a new tester should
walk the scenes in order — a wrong answer at Scene 1 means something more
basic is broken than a wrong answer at Scene 5.
