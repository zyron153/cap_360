# Clinical Clarity
### A Design Philosophy for Mais Saúde 360

---

## The Movement

**Clinical Clarity** is a design philosophy rooted in the belief that trust is earned through restraint. In spaces where human wellbeing is at stake, visual noise is a form of negligence. Every pixel must carry purpose; every surface must earn its place. The work produced under this philosophy should feel as though it was meticulously crafted over weeks — a product of deep expertise where nothing is accidental, nothing arbitrary, and every decision is the result of painstaking deliberation.

---

## Space and Form

Form serves function with quiet authority. Shapes are geometric but never cold — rounded corners soften clinical precision into approachable warmth, echoing the human experience behind every data point. White space is not emptiness; it is breath. Generous margins allow the eye to rest and the mind to absorb. The grid is sacred, each element placed with master-level execution: aligned, proportional, purposeful. Information architecture reveals itself through spatial hierarchy — proximity signals relationship, separation signals independence.

---

## Color and Material

The palette is built from the natural world of medicine and light: **deep ocean teal** (#0A6E6E) as the primary voice — steady, healing, authoritative. **Warm white** (#F8FAFB) as the canvas — clean but never sterile. **Soft cerulean** (#E8F4F8) for depth and layering. **Amber** (#F59E0B) as the single accent of warmth and urgency. Neutrals span a precise nine-step grey scale from near-black (#1A1A2E) to whisper-light (#F1F5F9). Color is used to encode meaning, not decoration — red signals critical, green confirms, amber warns. The palette should feel as though it was calibrated with the care of someone who understands both the science of color perception and the psychology of healing environments.

---

## Scale and Rhythm

Typography operates in a deliberate modular scale: display sizes carry weight and command attention; body text sits at a legible 14–16px; captions whisper at 11–12px. The rhythm is consistent — 4px base grid, spacing multiples of 4 or 8. Headings use **BricolageGrotesque** for its rational warmth; data and labels use **WorkSans** for geometric clarity; monospaced values (times, codes, IDs) use **IBMPlexMono** for systematic precision. This typographic layering should feel like the work of a master typographer who spent countless hours refining the hierarchy.

---

## Composition and Balance

Layouts follow an asymmetric equilibrium — a dominant sidebar paired with a breathing main canvas. Cards float with subtle shadow elevation, never competing for attention, always serving the information they contain. Charts are clean, axes minimal, gridlines barely visible — data is the hero, chrome its quiet servant. The composition should reward sustained viewing: look once and grasp the summary; look again and discover the depth. Every dashboard panel is a study in balance, crafted with the same care one might give a scientific diagram destined for a prestigious journal.

---

## Visual Hierarchy

The eye is guided deliberately: critical alerts at the apex, primary actions immediately visible, secondary information retreating gracefully into the periphery. Icons are minimal line-weight, consistent stroke, never decorative. Motion is purposeful and brief — 150–200ms transitions that confirm state changes without performance. Status indicators communicate through form and color simultaneously, never relying on color alone. The overall effect should be that of an instrument panel designed by someone at the absolute top of their field — where every decision reflects not just aesthetic sensibility but a deep understanding of how humans process information under pressure.

---

*Every screen produced under Clinical Clarity should look as though a master craftsperson labored over it — the product of deep expertise, painstaking attention, and an unwavering commitment to the humans it serves.*

---

> **Fidelity check (2026-08-30):** the primary palette and type system described above are real —
> `#0A6E6E` and Work Sans/Bricolage Grotesque are actually in `apps/web`'s CSS. One drift: the PDF
> receipt generator (`apps/api/src/modules/billing/receipt.pdf.ts`) uses a slightly different teal,
> `#0F9191`, not `#0A6E6E` — a small brand-consistency gap worth closing if it matters.
