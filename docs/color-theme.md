# Site color theme

Appalachian Bitcoin uses five brand colors. The three mountain colors match the existing logo; ivory and amethyst complete the palette.

| Color | Hex | Role |
| --- | --- | --- |
| Mist blue | `#A9C1CF` | Secondary accents, cash, comparison series |
| Copper | `#DB8046` | Primary actions, selected states, bitcoin, emphasis |
| Slate | `#304E5D` | Light-theme text, dark-theme surfaces, supporting chart series |
| Warm ivory | `#F8F7F3` | Light-theme canvas, dark-theme text |
| Amethyst | `#B37CDB` | Other assets, expense composition, supporting chart series |

The canonical `--brand-*` tokens and theme-specific role tokens live in `frontend/src/index.css`. Dark surfaces and light-theme accents use shades and mixes of these five colors with black or white to maintain contrast. Use role tokens such as `--accent`, `--blue`, `--amethyst`, `--chart-slate`, `--surface`, and `--muted` in components instead of adding hardcoded colors. Chart legends should use the same token as their plotted series.

Accounting colors remain independent: `--green` and `--red` retain their existing values in both themes for income, deductions, positive/negative amounts, and account activity. Existing warning, debt-risk, and spending-pressure status colors are also retained. Brand amethyst must not replace accounting green.

Category colors prioritize distinct hues: mist blue, copper, and amethyst. Four-series comparisons add ivory in dark mode and mist blue in light mode (where the secondary blue role uses slate). Amethyst uses a darker shade in light mode for legibility.
