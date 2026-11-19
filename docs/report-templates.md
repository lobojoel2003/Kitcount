# Report templates

Every state health department (and many funders) has its own reporting form.
Kitcount describes each form in a small **YAML template**. The app turns the
template into a finished report for any month, quarter or year with one tap,
and exports it as PDF or CSV.

Bundled templates live in [`/templates`](../templates):

| File | Period | Purpose |
| --- | --- | --- |
| `generic-monthly.yaml` | month | Encounters, participants, syringes, naloxone, test strips, referrals |
| `generic-quarterly.yaml` | quarter | Reach, distribution, linkage to care and inventory |
| `example-state-form.yaml` | month | A worked example showing every feature; not an official form |

> The bundled templates are generic starting points. **Always check line
> items and definitions against your state's current guidance** before
> submitting. States publish their own templates (for example
> [Kentucky's harm reduction data reporting guide](https://www.chfs.ky.gov/agencies/dph/Documents/datarg2025HarmReduction.pdf)).

## Using a template

- **Import in the app**: Reports → **Import YAML** → pick the file. Imported
  templates are stored in the encrypted database. An imported template with
  the same `id` as a bundled one replaces it.
- **Bundle it for everyone**: add the file to `/templates`, run
  `npm run templates` in `app/`, and open a pull request. CI validates every
  template and checks that the bundle is up to date.

## Format

```yaml
kitcount_template: 1            # format version (required)
id: my-state-monthly            # lowercase letters, digits, . _ - (required, must match the file name)
name: My State — SSP Monthly Report
jurisdiction: My State Department of Health
period: month                   # month | quarter | year
version: "2026.1"               # optional, printed on the report
source: https://…               # optional link to the official form
description: …                  # optional
disclaimer: …                   # optional, printed in the PDF footer

sections:
  - title: Section A — Encounters
    rows:
      - id: a1                  # optional; needed to use the row in a formula
        code: A1                # the form's own line number (optional)
        label: Total encounters # the form's exact wording
        help: Every logged visit # optional explanation
        metric: visits
```

Each row has **either** a `metric` **or** a `formula`.

### Metrics

| Metric | Value | Filters |
| --- | --- | --- |
| `visits` | Participant encounters | `anonymous: true` (no code given) or `false` |
| `participants` | Unduplicated participants (unique codes) | — |
| `new_participants` | Participants whose first-ever visit is in the period | — |
| `returning_participants` | Participants seen before the period | — |
| `supplies_out` | Units handed out | `supply` (all supplies if omitted) |
| `visits_with_supply` | Visits where a supply was handed out | `supply` |
| `participants_with_supply` | Unduplicated participants who received a supply | `supply` |
| `syringes_in` | Used syringes collected | — |
| `reversals` | Overdose reversals reported by participants | — |
| `visits_with_reversal` | Visits with at least one reported reversal | — |
| `referrals` | Referrals made | `referral` |
| `participants_referred` | Unduplicated participants referred | `referral` |
| `visits_with_referral` | Visits with a referral | `referral` |
| `secondary` | People reached through secondary distribution | — |
| `stock_received` | Units received into inventory | `supply` |
| `stock_on_hand` | Program-wide units on hand at the end of the period | `supply` |
| `manual` | A number staff type in when generating the report | — |

`supply` and `referral` take one id or a list:

```yaml
- label: Naloxone kits distributed
  metric: supplies_out
  supply: [naloxone_nasal, naloxone_im]
```

Default supply ids: `syringes`, `naloxone_nasal`, `naloxone_im`,
`fentanyl_strips`, `xylazine_strips`, `cookers`, `cottons`, `sterile_water`,
`alcohol_pads`, `tourniquets`, `sharps_containers`, `wound_care`,
`smoking_kits`, `condoms`, `hygiene_kits`.

Default referral ids: `moud`, `sud_treatment`, `hiv_testing`, `hcv_testing`,
`prep`, `medical`, `mental_health`, `housing`, `benefits`, `vaccination`.

If a template names an id the program does not track, the report still runs,
shows 0 for that row, and warns staff before they submit.

### Formulas

Formulas combine other rows by `id` with `+ - * /` and parentheses:

```yaml
- id: return_rate
  label: Syringe return rate
  formula: syringes_in / syringes_out
  format: percent           # integer | decimal | percent
```

Division by zero shows `—`. Formulas may refer to rows anywhere in the
template; cycles are rejected when the template is loaded.

## Validation

Templates are validated strictly. Unknown keys, unknown metrics, filters on
the wrong metric, duplicate ids, bad formulas and cycles are all errors, and
the message names the exact row. Run the checks locally with:

```bash
cd app
npm run templates   # re-bundle after editing /templates
npm test            # validates every template and computes it on sample data
```

The JSON Schema in [`templates/schema.json`](../templates/schema.json) gives
editors such as VS Code autocompletion. Add this first line to a template:

```yaml
# yaml-language-server: $schema=./schema.json
```
